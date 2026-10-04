# ADR-0006: Transport — WSS relay (local reference and AWS), no production polling fallback

- Status: accepted (revision 1)
- Date: 2026-10-05

## Decision

- Primary transport: WebSocket over TLS (WSS) to a relay that implements PROTOCOL.md v1 using one shared relay core (`services/relay/core`). Two adapters: `services/relay/local` (Node.js, in-memory store, HTTPS + WSS, also serves the phone page) and `services/relay/aws` (API Gateway WebSocket + Lambda + DynamoDB).
- **No production HTTP polling fallback** is implemented in the core release. Polling would add queue ownership, transient payload retention, request volume and cost questions (master prompt §6). If T03 shows WSS cannot work from the Vega Virtual Device, a separate ADR must be written before any polling code.
- Reconnect: clients reconnect with exponential backoff 0.5, 1, 2, 4, 8 s (cap 8 s), using `auth.resume`. Any window open at disconnect is cancelled and unscored; a fresh explicit Start is required after reconnect.
- Heartbeat: `ping` every 10 s; peer considered unknown after 25 s without traffic. The TV shows "Phone state unknown" — never "Mic off" — when the link drops.
- API Gateway limits respected: 2 h connection lifetime (clients re-dial at 110 min when idle between windows), 10 min idle timeout (heartbeat), 32 KB frame limit (our limit is 8 KB).

## Local development and HTTPS

- A physical phone needs a trustworthy HTTPS origin for `getUserMedia`. `http://<Mac-LAN-IP>` is **not** a valid microphone origin and is never presented as one.
- Supported routes: (a) AWS staging CloudFront URL; (b) local relay with a locally generated TLS certificate whose CA the owner installs on the phone; (c) an owner-run HTTPS tunnel. Same-Mac `https://localhost` uses the Mac microphone and is labelled "Same-Mac microphone mode". Fixture replay is labelled "Fixture replay".
- Only physical-phone runs can qualify the intended microphone workflow (evidence class `real_phone`).
