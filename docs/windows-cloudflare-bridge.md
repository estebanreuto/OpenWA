# Windows to Hostinger bridge

The local keeper starts `scripts/openwa-cloudflare-bridge.mjs` when
`data/openwa-cloudflare.json` exists. The bridge listens only on loopback and
exposes only the configured sessions' status, text/image sends, and media downloads.
OpenWA still validates every API key. Dashboard, authentication, administration,
session lifecycle and other sessions are unavailable through the gateway.

The config contains `port`, a local `upstream`, the installed `cloudflared` path,
and a `projects` array with `slug`, `sessionId`, `callbackUrl`, `registrationUrl`.
No secrets belong in this file. The existing active webhook's custom header is
read locally to sign connection registrations.

Deploy FunnessAdmin's `api/openwa-bridge.php` to the matching Hostinger project.
The endpoint accepts a fresh HMAC signed with that project's existing webhook key.
It restricts the new address to HTTPS `*.trycloudflare.com` origins, verifies the
authenticated session through that address, and then changes only `openwa_url`.
It cannot change keys, session IDs, payment settings, AI settings or membership data.

The bridge reconnects cloudflared after an exit and registers a changed URL with
Hostinger automatically. It retries registration while internet, OpenWA or
Hostinger are unavailable. Status is in `data/openwa-cloudflare-status.json`;
logs are in `data/openwa-bridge-*.log`. The same mechanism supports multiple
projects, with one allowlisted session and one registration destination per project.

Quick Tunnels are for testing/development, have no uptime guarantee and change
hostname after restart. Auto-registration handles the hostname change but cannot
give the Cloudflare service an uptime guarantee. For production, use a named
Cloudflare Tunnel with a stable hostname. The PC still needs power, internet and
an active Windows user session for the current per-user startup configuration.

Validation: `node --test scripts/openwa-cloudflare-bridge.spec.mjs`.

## Opening the local dashboard

`Abrir-OpenWA.cmd` calls `scripts/openwa-open.ps1`, which reads only the local
PORT setting, checks `/api/health`, starts the existing keeper if necessary,
and waits up to three minutes before opening `/sessions`. It never launches
a second OpenWA instance directly, clears profiles, or unlinks WhatsApp.
`-NoOpen` checks readiness without opening a browser and is useful for testing.

The keeper accepts `-OpenDashboard` to start this readiness-aware opener once
when the keeper starts. The Windows logon task and its existing per-user Run
fallback use that flag. The keeper's exclusive lock prevents duplicate loops.
This opens the panel after login, not while Windows is logged out or powered off.
