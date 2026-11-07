#!/usr/bin/env bash
# CI only: a throwaway certificate authority and a certificate for the local production server
# the mobile workflows point their production apps at. Production apps accept only HTTPS, so CI
# serves the app's own `farm build --mobile` server over TLS and trusts this CA on the simulator.
# Never ship or reuse these files: the private keys live only for one CI run.
#
#   ci-tls.sh <dir>   writes <dir>/ca.pem, <dir>/server.pem, <dir>/server-key.pem
#
# Extensions come from config sections, which OpenSSL and macOS's LibreSSL read the same way.
set -euo pipefail
dir="$1"
mkdir -p "$dir"
cd "$dir"
cat > tls.cnf <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Farm CI local server CA
[server_dn]
CN = localhost
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
# What iOS requires of a server certificate: a subject alternative name, serverAuth, SHA-256,
# RSA 2048, and at most 825 days of validity.
[v3_server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1, IP:::1
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
CNF
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 7 -config tls.cnf -extensions v3_ca \
  -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -new -newkey rsa:2048 -sha256 -nodes -config tls.cnf -subj "/CN=localhost" \
  -keyout server-key.pem -out server.csr 2>/dev/null
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -set_serial "0x$(openssl rand -hex 8)" \
  -sha256 -days 7 -extfile tls.cnf -extensions v3_server -out server.pem 2>/dev/null
rm -f ca-key.pem server.csr tls.cnf
openssl verify -CAfile ca.pem server.pem
