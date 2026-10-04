# Running the relay locally

The local relay is the reference implementation of PROTOCOL.md v1: the same `RelayCore` as the AWS deployment with an in-memory store, served over HTTPS and WSS by `services/relay/src/local`. It also serves the phone page. State lives in memory and is lost on restart (TV and phone pair again).

```sh
npm install
npm run build -w @atr/phone              # produces apps/phone/dist (see the phone package for its own build command)
scripts/dev-certs/make-dev-certs.sh 192.168.1.23    # your Mac's LAN IP; omit for localhost-only
npm run start:local -w @atr/relay        # builds @atr/protocol and the relay, then listens on https://0.0.0.0:8443
```

`start:local` prints what it serves and which browser origins it allows. Health check: `curl --cacert certs/ca.crt https://localhost:8443/healthz` answers `{"status":"ok"}`.

## Which microphone route is valid

| Route | Phone page origin | Evidence class | Notes |
|---|---|---|---|
| Physical phone, local relay | `https://<Mac-LAN-IP>:8443` with the local CA trusted on the phone | `real_phone` once run on a real phone | Needs the certificate steps below |
| Physical phone, AWS staging | the CloudFront URL | `real_phone` | `infra/README.md`; not deployed |
| Physical phone through an HTTPS tunnel | the tunnel's HTTPS URL (owner-run) | `real_phone` | Add the tunnel origin to `ATR_ALLOWED_ORIGINS` |
| Same Mac | `https://localhost:8443` or `http://localhost:8443` in insecure mode | labelled "Same-Mac microphone mode" | Uses the Mac's microphone, not a phone |
| Fixture replay | any | labelled "Fixture replay" | Numeric replay, no microphone |

**`http://<Mac-LAN-IP>` is never a valid microphone origin.** Browsers expose `getUserMedia` only on secure contexts (HTTPS, or `localhost`); a plain-HTTP LAN address is neither. The relay refuses to start without TLS unless `ATR_INSECURE_LOCALHOST_ONLY=1`, and that mode binds to 127.0.0.1 only and prints a warning that phones cannot use it.

## Certificates

`scripts/dev-certs/make-dev-certs.sh [--out DIR] [--force] [--no-name-constraints] [LAN_IP_OR_HOSTNAME ...]` uses OpenSSL (OpenSSL 3 and macOS LibreSSL both tested) to create:

- `certs/ca.crt` and `certs/ca.key`: a local certificate authority, valid 10 years, **name-constrained** to loopback, RFC 1918 private ranges, `localhost` and `.local`, so a leaked `ca.key` cannot impersonate public sites;
- `certs/server.crt` and `certs/server.key`: a server certificate valid 365 days with subject alternative names `localhost`, `127.0.0.1`, `::1` and every address or name you pass.

`certs/` is already ignored by git. Re-running keeps the CA and re-issues only the server certificate, so when your LAN address changes the phone does not need to trust anything new. `--force` replaces the CA (the phone must then trust the new one).

**The owner must install and trust `certs/ca.crt` on the phone; nothing in this repository does that, and it has not been tested on a phone.**

- iOS: send `ca.crt` to the phone (AirDrop or Files), open it, choose to install the profile (Settings > General > VPN & Device Management), then enable full trust (Settings > General > About > Certificate Trust Settings). Compare the SHA-256 fingerprint the script printed.
- Android: Settings > Security and privacy > More security settings > Encryption and credentials > Install a certificate > CA certificate. Chrome on recent Android versions honours user-installed CAs; some apps do not.

The Vega virtual device and a physical Fire TV may not trust a user-installed CA. **It is not known whether self-signed WSS works from the Vega runtime**; this is a pending T03 check. Do not promise it works before testing.

## Configuration

Set through the environment (relative paths resolve against `services/relay`):

| Variable | Default | Meaning |
|---|---|---|
| `ATR_PORT` | `8443` | TCP port (0 picks a free one) |
| `ATR_HOST` | `0.0.0.0`, or `127.0.0.1` in insecure mode | Bind address (insecure mode accepts only loopback) |
| `ATR_ENV` | `development` | `development`, `staging` or `production`. `production` rejects `client.platform: test` (a self-declared value is never a trust signal), refuses `ATR_TV_PREVIEW_ORIGINS`, insecure mode and any localhost or `http` origin, and requires `ATR_ALLOWED_ORIGINS` to be set explicitly. |
| `ATR_ALLOWED_ORIGINS` | `https://localhost:PORT`, `https://127.0.0.1:PORT` and `https://<each detected LAN IPv4>:PORT` (`http` variants in insecure mode) | Comma-separated **exact** phone-page origins allowed to open a WebSocket. No wildcards, paths or trailing slashes; `https` only (`http` only for localhost). Phone-role operations need one of these. |
| `ATR_TV_PREVIEW_ORIGINS` | none | Comma-separated exact origins of a TV web-preview page (development only). A preview origin can create rooms and resume as the TV but can never act as a phone, and a phone origin can never act as a TV. Never part of a production allowlist. A connection without any Origin (a native client) may also use the TV operations. |
| `ATR_LIVE_ROOM_CAP` | `200` | Global cap on live rooms (open, unexpired, and connected or idle for less than 30 minutes). `room.create` over the cap is refused with `rate_limited`. |
| `ATR_STATIC_DIR` | `../../apps/phone/dist` | Phone page directory served at `/` (symlinks leaving it are refused) |
| `ATR_TLS_CERT`, `ATR_TLS_KEY` | `../../certs/server.crt`, `../../certs/server.key` | Certificate and key (PEM) |
| `ATR_INSECURE_LOCALHOST_ONLY` | unset | `1` serves plain HTTP and WS on 127.0.0.1 only; phones cannot use it |
| `ATR_HSTS_MAX_AGE` | `300` | Seconds in the `Strict-Transport-Security` header (kept short so `localhost` is not pinned to HTTPS for a year) |
| `ATR_TICK_MS` | `5000` | Sweep interval for the authentication deadline and the 25 s heartbeat window |
| `RELAY_DISABLED` | unset | `true` starts with the kill switch on (new sockets get 503; messages get an error and a 4503 close). `SIGUSR2` toggles it at runtime. |

Endpoints: `/` and assets (GET, HEAD), `/ws` (WebSocket), `/healthz`. Every response carries `Content-Security-Policy` (`default-src 'self'; connect-src 'self' wss:; script-src 'self'; worker-src 'self' blob:` plus `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`), `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and, over TLS, HSTS. With a CSP of `default-src 'self'`, the phone page must not use inline `<script>` or inline `style` attributes or `<style>` blocks.

## Tests

`npm test -w @atr/relay` runs the whole suite, including a real HTTPS and WSS server on an ephemeral port with a certificate generated by the script above (needs `openssl` on the PATH; that test group is skipped if it is missing).
