import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const MAX_BODY = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function routeAllowed(method, pathname, sessionIds) {
  const match = /^\/api\/sessions\/([^/]+)(.*)$/.exec(pathname);
  if (!match || !sessionIds.includes(match[1])) return false;
  if (method === 'GET' && match[2] === '') return true;
  if (method === 'POST' && /^\/messages\/send-(text|image)$/.test(match[2])) return true;
  const media = /^\/messages\/([^/]+)\/([^/]+)\/media$/.exec(match[2]);
  if (method !== 'GET' || !media) return false;
  try {
    return media.slice(1).every(part => {
      const decoded = decodeURIComponent(part);
      return decoded !== '.' && decoded !== '..' && !/[\\/\x00-\x20]/.test(decoded);
    });
  } catch {
    return false;
  }
}

export function registrationSignature(secret, project, sessionId, url, timestamp) {
  return createHmac('sha256', secret)
    .update(['openwa-bridge-v1', project, sessionId, url, String(timestamp)].join('\n'))
    .digest('hex');
}

function json(response, code, value) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createGateway({ upstream, sessionIds, maxBody = MAX_BODY, maxConcurrent = 8 }) {
  const origin = new URL(upstream);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
    throw new Error('The gateway upstream must be a local HTTP service.');
  }
  if (!sessionIds.length || !sessionIds.every(id => UUID.test(id))) throw new Error('Invalid session allowlist.');
  let active = 0;
  const server = createServer(async (request, response) => {
    const rawPath = request.url || '/';
    if (rawPath.includes('?') || !routeAllowed(request.method, rawPath, sessionIds)) {
      request.resume();
      return json(response, 404, { error: 'route_not_available' });
    }
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      request.resume();
      return json(response, 401, { error: 'api_key_required' });
    }
    if (active >= maxConcurrent) {
      request.resume();
      return json(response, 429, { error: 'busy' });
    }
    if (Number(request.headers['content-length'] || 0) > maxBody) {
      request.resume();
      return json(response, 413, { error: 'payload_too_large' });
    }
    active++;
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > maxBody) return json(response, 413, { error: 'payload_too_large' });
        chunks.push(chunk);
      }
      const headers = { 'x-api-key': apiKey, accept: 'application/json' };
      if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
      if (request.headers['idempotency-key']) headers['idempotency-key'] = request.headers['idempotency-key'];
      const result = await fetch(origin.origin + rawPath, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? Buffer.concat(chunks) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      response.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (result.body) {
        await pipeline(Readable.fromWeb(result.body), response);
      } else response.end();
    } catch {
      json(response, 502, { error: 'openwa_unavailable' });
    } finally {
      active--;
    }
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  return server;
}

function readWebhookSecret(root, project) {
  const database = new Database(path.join(root, 'data/openwa.sqlite'), { readonly: true });
  try {
    const webhook = database
      .prepare('SELECT headers FROM webhooks WHERE sessionId = ? AND url = ? AND active = 1 LIMIT 1')
      .get(project.sessionId, project.callbackUrl);
    const headers = JSON.parse(webhook?.headers || '{}');
    const entry = Object.entries(headers).find(([name]) =>
      ['x-funness-openwa-webhook-key', 'x-project-webhook-key'].includes(name.toLowerCase()),
    );
    if (!entry || typeof entry[1] !== 'string' || entry[1].length < 16) throw new Error('Webhook key not configured.');
    return entry[1];
  } finally {
    database.close();
  }
}

async function run(configPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  const projects = config.projects;
  if (!Array.isArray(projects) || !projects.length) throw new Error('No bridge projects configured.');
  for (const project of projects) {
    const callback = new URL(project.callbackUrl);
    const registration = new URL(project.registrationUrl);
    if (callback.protocol !== 'https:' || registration.origin !== callback.origin)
      throw new Error('Invalid registration origin.');
  }
  const statusPath = path.join(root, 'data/openwa-cloudflare-status.json');
  const state = { publicUrl: null, cloudflarePid: null, projects: {}, startedAt: new Date().toISOString() };
  const save = () =>
    writeFileSync(statusPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  const log = (event, details = {}) =>
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
  const gateway = createGateway({ upstream: config.upstream, sessionIds: projects.map(project => project.sessionId) });
  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(config.port, '127.0.0.1', resolve);
  });
  log('gateway_started', { port: config.port });
  let child;
  let stopping = false;
  let syncing = false;
  let nextSync = 0;

  async function sync() {
    if (syncing || !state.publicUrl || Date.now() < nextSync) return;
    syncing = true;
    const url = state.publicUrl;
    let allReady = true;
    try {
      for (const project of projects) {
        try {
          const timestamp = Math.floor(Date.now() / 1000);
          const signature = registrationSignature(
            readWebhookSecret(root, project),
            project.slug,
            project.sessionId,
            url,
            timestamp,
          );
          const result = await fetch(project.registrationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-OpenWA-Bridge-Signature': signature },
            body: JSON.stringify({ project: project.slug, session_id: project.sessionId, url, timestamp }),
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
          });
          const data = await result.json().catch(() => ({}));
          if (state.publicUrl !== url) return;
          if (!result.ok || data.success !== true)
            throw new Error(`registration_http_${result.status}_${/^[a-z_]+$/.test(data.code) ? data.code : 'failed'}`);
          state.projects[project.slug] = {
            ready: true,
            syncedAt: new Date().toISOString(),
            sessionStatus: data.session_status,
          };
          log('project_connected', { project: project.slug });
        } catch (error) {
          allReady = false;
          state.projects[project.slug] = { ready: false, error: error.message };
          log('project_connection_pending', { project: project.slug, reason: error.message });
        }
      }
      save();
    } finally {
      syncing = false;
      nextSync = Date.now() + (allReady ? 300_000 : 15_000);
    }
  }

  function startTunnel() {
    if (stopping) return;
    state.publicUrl = null;
    state.projects = {};
    child = spawn(
      config.cloudflared,
      ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${config.port}`],
      {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    state.cloudflarePid = child.pid;
    save();
    let tail = '';
    const observe = chunk => {
      tail = (tail + chunk.toString()).slice(-16_000);
      const url = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0];
      if (url && state.publicUrl !== url) {
        state.publicUrl = url;
        nextSync = 0;
        save();
        log('tunnel_created', { url });
        void sync();
      }
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', error => log('tunnel_error', { code: error.code || 'start_failed' }));
    child.once('close', code => {
      state.publicUrl = null;
      state.cloudflarePid = null;
      state.projects = {};
      save();
      log('tunnel_stopped', { code });
      if (!stopping) setTimeout(startTunnel, 15_000);
    });
  }
  const timer = setInterval(() => void sync(), 15_000);
  function stop() {
    stopping = true;
    clearInterval(timer);
    child?.kill();
    gateway.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  startTunnel();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  mkdirSync(path.join(root, 'data'), { recursive: true });
  run(process.argv[2] || path.join(root, 'data/openwa-cloudflare.json')).catch(error => {
    console.error(JSON.stringify({ event: 'bridge_failed', reason: error.message }));
    process.exitCode = 1;
  });
}
