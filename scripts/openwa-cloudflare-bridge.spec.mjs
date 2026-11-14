import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createGateway, routeAllowed, registrationSignature } from './openwa-cloudflare-bridge.mjs';

const session = 'aae0f27b-9a9c-48ae-8094-2ce7cae26dec';
const other = 'aaaaf27b-9a9c-48ae-8094-2ce7cae26dec';
const base = `/api/sessions/${session}`;

test('public gateway exposes only the configured session and required operations', () => {
  assert.equal(routeAllowed('POST', `${base}/messages/send-text`, [session]), true);
  assert.equal(routeAllowed('POST', `${base}/messages/send-image`, [session]), true);
  assert.equal(routeAllowed('GET', `${base}/messages/123%40lid/M123/media`, [session]), true);
  assert.equal(routeAllowed('GET', base, [session]), true);
  for (const [method, path] of [
    ['GET', '/'],
    ['GET', '/api/auth/api-keys'],
    ['GET', '/api/sessions'],
    ['POST', `/api/sessions/${other}/messages/send-text`],
    ['POST', `${base}/logout`],
    ['GET', `${base}/messages`],
    ['POST', `${base}/messages/send-file`],
    ['GET', `${base}/messages/a%2Fb/M123/media`],
    ['GET', `${base}/messages/%2e%2e/M123/media`],
    ['GET', `${base}/messages/%ZZ/M123/media`],
  ])
    assert.equal(routeAllowed(method, path, [session]), false, `${method} ${path}`);
});

test('registration proof is bound to the project, session, URL and timestamp', () => {
  const secret = 'test-secret-with-more-than-32-characters';
  const proof = registrationSignature(secret, 'funness', session, 'https://one.trycloudflare.com', 123);
  assert.equal(proof.length, 64);
  assert.equal(proof, registrationSignature(secret, 'funness', session, 'https://one.trycloudflare.com', 123));
  for (const args of [
    [secret, 'other', session, 'https://one.trycloudflare.com', 123],
    [secret, 'funness', other, 'https://one.trycloudflare.com', 123],
    [secret, 'funness', session, 'https://two.trycloudflare.com', 123],
    [secret, 'funness', session, 'https://one.trycloudflare.com', 124],
    ['other-secret', 'funness', session, 'https://one.trycloudflare.com', 123],
  ])
    assert.notEqual(proof, registrationSignature(...args));
});

test('gateway keeps upstream authentication, strips cookies, and rejects invalid traffic', async t => {
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    res.writeHead(req.headers['x-api-key'] === 'valid-test-key' ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createGateway({
    upstream: `http://127.0.0.1:${upstream.address().port}`,
    sessionIds: [session],
    maxBody: 128,
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all(
      [gateway, upstream].map(
        server =>
          new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
          }),
      ),
    );
  });
  const url = `http://127.0.0.1:${gateway.address().port}`;
  const headers = {
    'x-api-key': 'valid-test-key',
    'content-type': 'application/json',
    cookie: 'do-not-forward',
    authorization: 'do-not-forward',
  };
  const result = await fetch(url + base + '/messages/send-text', { method: 'POST', headers, body: '{"text":"test"}' });
  assert.equal(result.status, 200);
  await result.json();
  assert.equal(requests[0].body, '{"text":"test"}');
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers['x-api-key'], 'valid-test-key');
  assert.equal((await fetch(url + base)).status, 401);
  assert.equal((await fetch(url + base, { headers: { 'x-api-key': 'invalid' } })).status, 401);
  assert.equal((await fetch(url + '/api/auth/api-keys', { headers })).status, 404);
  assert.equal((await fetch(url + base + '?x=1', { headers })).status, 404);
  assert.equal(
    (await fetch(url + base + '/messages/send-text', { method: 'POST', headers, body: 'x'.repeat(129) })).status,
    413,
  );
  assert.equal(requests.length, 2);
});

test('gateway never forwards to an external upstream', () => {
  assert.throws(() => createGateway({ upstream: 'https://example.com', sessionIds: [session] }));
});
