#!/usr/bin/env bash
# Creates a local development CA and a TLS server certificate for the local relay.
#
#   scripts/dev-certs/make-dev-certs.sh [--out DIR] [--force] [--no-name-constraints] [LAN_IP_OR_HOSTNAME ...]
#
# Output (default: <repo>/certs/, which is gitignored):
#   ca.crt / ca.key        local CA. ca.crt is what you install on the phone. ca.key never leaves this machine.
#   server.crt / server.key  server certificate (SANs: localhost, 127.0.0.1, ::1 and each argument)
#
# Re-running keeps the existing CA (so the phone does not have to trust a new one) and re-issues only the server
# certificate with the SANs you pass now. Use --force to create a new CA as well.
#
# The CA is name-constrained to loopback, RFC 1918 private IPv4 ranges, "localhost" and ".local" names, so a leaked
# ca.key cannot be used to impersonate public sites. Use --no-name-constraints only if you need an address outside
# those ranges (not recommended; also untested on phones).
#
# Only OpenSSL is required. Nothing is installed, trusted or uploaded by this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$REPO_ROOT/certs"
FORCE=0
NAME_CONSTRAINTS=1
SANS=()

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || { echo "error: --out needs a directory" >&2; exit 2; }; OUT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --no-name-constraints) NAME_CONSTRAINTS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option $1" >&2; usage >&2; exit 2 ;;
    *) SANS+=("$1"); shift ;;
  esac
done

OPENSSL="${OPENSSL:-openssl}"
command -v "$OPENSSL" >/dev/null 2>&1 || { echo "error: openssl not found (set OPENSSL=/path/to/openssl)" >&2; exit 1; }

is_ipv4() { [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] && for o in "${BASH_REMATCH[@]:1}"; do [ "$o" -le 255 ] || return 1; done; }
is_hostname() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]]; }
in_private_range() {
  IFS=. read -r a b _ _ <<<"$1"
  [ "$a" -eq 127 ] || [ "$a" -eq 10 ] || { [ "$a" -eq 192 ] && [ "$b" -eq 168 ]; } || { [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; }
}

SAN_LINES=("DNS.1 = localhost" "IP.1 = 127.0.0.1" "IP.2 = ::1")
dns_n=1; ip_n=2
for s in ${SANS[@]+"${SANS[@]}"}; do
  if is_ipv4 "$s"; then
    if [ "$NAME_CONSTRAINTS" -eq 1 ] && ! in_private_range "$s"; then
      echo "error: $s is outside loopback/RFC 1918 ranges; the CA is name-constrained. Use --no-name-constraints (not recommended)." >&2
      exit 2
    fi
    ip_n=$((ip_n + 1)); SAN_LINES+=("IP.$ip_n = $s")
  elif is_hostname "$s"; then
    case "$s" in
      localhost|*.local) ;;
      *) if [ "$NAME_CONSTRAINTS" -eq 1 ]; then echo "error: hostname $s is not localhost or *.local; use --no-name-constraints (not recommended)." >&2; exit 2; fi ;;
    esac
    dns_n=$((dns_n + 1)); SAN_LINES+=("DNS.$dns_n = $s")
  else
    echo "error: '$s' is neither an IPv4 address nor a hostname" >&2; exit 2
  fi
done

mkdir -p "$OUT"
chmod 700 "$OUT"
umask 077
TMP="$(mktemp -d "${TMPDIR:-/tmp}/atr-certs.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

CA_KEY="$OUT/ca.key"; CA_CRT="$OUT/ca.crt"
if [ "$FORCE" -eq 1 ] || [ ! -f "$CA_KEY" ] || [ ! -f "$CA_CRT" ]; then
  [ "$FORCE" -eq 1 ] && [ -f "$CA_CRT" ] && echo "note: --force replaces the CA; the phone must trust the new ca.crt."
  {
    echo "[ext]"
    echo "basicConstraints = critical, CA:TRUE, pathlen:0"
    echo "keyUsage = critical, keyCertSign, cRLSign"
    echo "subjectKeyIdentifier = hash"
    if [ "$NAME_CONSTRAINTS" -eq 1 ]; then
      echo "nameConstraints = critical, @nc"
      echo "[nc]"
      echo "permitted;DNS.1 = localhost"
      echo "permitted;DNS.2 = .local"
      echo "permitted;IP.1 = 127.0.0.0/255.0.0.0"
      echo "permitted;IP.2 = 10.0.0.0/255.0.0.0"
      echo "permitted;IP.3 = 172.16.0.0/255.240.0.0"
      echo "permitted;IP.4 = 192.168.0.0/255.255.0.0"
      echo "permitted;IP.5 = 0:0:0:0:0:0:0:1/ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
    fi
  } >"$TMP/ca.ext"
  "$OPENSSL" ecparam -name prime256v1 -genkey -noout -out "$CA_KEY"
  "$OPENSSL" req -x509 -new -key "$CA_KEY" -sha256 -days 3650 \
    -subj "/CN=Across the Room local development CA" -extensions ext -config <(cat <<CONF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Across the Room local development CA
$(cat "$TMP/ca.ext")
CONF
) -out "$CA_CRT"
  echo "created CA: $CA_CRT"
else
  echo "reusing existing CA: $CA_CRT"
fi

{
  echo "basicConstraints = critical, CA:FALSE"
  echo "keyUsage = critical, digitalSignature"
  echo "extendedKeyUsage = serverAuth"
  echo "subjectAltName = @san"
  echo "subjectKeyIdentifier = hash"
  echo "authorityKeyIdentifier = keyid"
  echo "[san]"
  printf '%s\n' "${SAN_LINES[@]}"
} >"$TMP/server.ext"

"$OPENSSL" ecparam -name prime256v1 -genkey -noout -out "$OUT/server.key"
"$OPENSSL" req -new -key "$OUT/server.key" -subj "/CN=localhost" -out "$TMP/server.csr"
"$OPENSSL" x509 -req -in "$TMP/server.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial -CAserial "$OUT/ca.srl" \
  -sha256 -days 365 -extfile "$TMP/server.ext" -out "$OUT/server.crt" 2>/dev/null
chmod 600 "$OUT/ca.key" "$OUT/server.key"
chmod 644 "$OUT/ca.crt" "$OUT/server.crt"

"$OPENSSL" verify -CAfile "$CA_CRT" "$OUT/server.crt" >/dev/null
echo "created server certificate: $OUT/server.crt (valid 365 days) for:"
printf '  %s\n' "${SAN_LINES[@]}" | sed 's/^  [A-Z]*\.[0-9]* = /  /'
echo
echo "CA fingerprint (SHA-256), compare it on the phone when installing:"
"$OPENSSL" x509 -in "$CA_CRT" -noout -fingerprint -sha256
echo
cat <<'NEXT'
Next steps (see docs/operations/LOCAL_RELAY.md):
  1. Start the relay:  ATR_TLS_CERT=certs/server.crt ATR_TLS_KEY=certs/server.key npm run start:local -w @atr/relay
  2. Physical phone: install and trust certs/ca.crt on the phone yourself (iOS: AirDrop/Files, then
     Settings > General > VPN & Device Management, then Settings > General > About > Certificate Trust Settings;
     Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate).
     This script does not and cannot do that for you.
  3. Open https://<LAN-IP>:8443 on the phone. http://<LAN-IP> is NEVER a valid microphone origin.
  4. Add that origin to ATR_ALLOWED_ORIGINS if it is not one of the machine's detected addresses.
Never share or commit ca.key or server.key.
NEXT
