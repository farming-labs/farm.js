#!/usr/bin/env bash
# CI only: a throwaway certificate authority and a certificate for the local production server
# the mobile workflows point their production apps at. Production apps accept only HTTPS, so CI
# serves the app's own `farm build --mobile` server over TLS and trusts this CA on the simulator.
# Never ship or reuse these files: the private keys live only for one CI run.
#
#   ci-tls.sh <dir>   writes <dir>/ca.pem, <dir>/server.pem, <dir>/server-key.pem
set -euo pipefail
dir="$1"
mkdir -p "$dir"
cd "$dir"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 7 \
  -keyout ca-key.pem -out ca.pem -subj "/CN=Farm CI local server CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
# What iOS requires of a server certificate: a subject alternative name, serverAuth, SHA-256,
# RSA 2048, and at most 825 days of validity.
cat > server.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
EXT
openssl req -newkey rsa:2048 -sha256 -nodes -keyout server-key.pem -out server.csr \
  -subj "/CN=localhost" 2>/dev/null
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -sha256 -days 7 \
  -extfile server.ext -out server.pem 2>/dev/null
rm -f ca-key.pem server.csr server.ext ca.srl
