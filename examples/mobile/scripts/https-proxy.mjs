// CI only: serves the app's own production server (`farm build --mobile`'s Node build) over
// HTTPS, so a production iOS app, which accepts only HTTPS, can load it. Requests and responses
// pass through unchanged, with X-Forwarded-Proto: https.
//
//   node scripts/https-proxy.mjs <cert.pem> <key.pem> <https-port> <http-target-port>
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const [cert, key, port, target] = process.argv.slice(2);
if (!cert || !key || !port || !target) {
  console.error("Usage: node scripts/https-proxy.mjs <cert.pem> <key.pem> <https-port> <http-target-port>");
  process.exit(1);
}

const handle = (request, response) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: Number(target),
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        "x-forwarded-proto": "https",
        "x-forwarded-host": request.headers.host ?? `localhost:${port}`,
      },
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end(`The local production server did not answer: ${error.message}\n`);
  });
  request.pipe(upstream);
};

const tls = { cert: readFileSync(cert), key: readFileSync(key) };
// `localhost` resolves to ::1 first on macOS, and the simulator shares the Mac's network: answer
// on both loopback addresses, never on another interface.
for (const host of ["127.0.0.1", "::1"]) {
  const server = https.createServer(tls, handle);
  server.on("error", (error) => {
    console.error(`https://[${host}]:${port}: ${error.message}`);
    if (host === "127.0.0.1") process.exit(1);
  });
  server.listen(Number(port), host, () => {
    console.log(`https://${host.includes(":") ? `[${host}]` : host}:${port} -> http://127.0.0.1:${target}`);
  });
}
