# Local development certificates

`make-dev-certs.sh` creates a name-constrained local CA and a server certificate for the local relay (`services/relay`). Output goes to `certs/` at the repository root (git-ignored).

```sh
scripts/dev-certs/make-dev-certs.sh                       # localhost, 127.0.0.1, ::1
scripts/dev-certs/make-dev-certs.sh 192.168.1.23          # plus your LAN IP, for a physical phone
scripts/dev-certs/make-dev-certs.sh --out /some/dir macbook.local
```

Options: `--out DIR`, `--force` (replace the CA too), `--no-name-constraints` (not recommended; also untested on phones). Re-running keeps the CA and re-issues only the server certificate. Both certificates are short-lived (T16 N-06): the CA is valid 90 days and the server certificate for as long as the CA remains valid (at most 90 days). A CA with fewer than 14 days left, or an expired one, is replaced automatically and the script says so; the phone then has to trust the new `ca.crt`.

Read `docs/operations/LOCAL_RELAY.md` before using it: the owner must trust `ca.crt` on the phone, and `http://<LAN-IP>` is never a valid microphone origin. The script installs and trusts nothing and uploads nothing. Never commit or share `ca.key` or `server.key`.
