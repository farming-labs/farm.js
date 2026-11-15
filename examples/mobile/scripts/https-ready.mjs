// CI only: waits until the local HTTPS production server answers `GET /` with a certificate the
// run's CA signed, using Node's TLS with that CA and nothing else trusted.
//
//   node scripts/https-ready.mjs <ca.pem> <url> [seconds]
import { readFileSync } from "node:fs";
import https from "node:https";

const [caFile, url, seconds = "60"] = process.argv.slice(2);
const ca = readFileSync(caFile);
const deadline = Date.now() + Number(seconds) * 1000;
let lastError = "no attempt";
while (Date.now() < deadline) {
  const status = await new Promise((resolve) => {
    const request = https.get(url, { ca }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", (error) => {
      lastError = error.message;
      resolve(undefined);
    });
  });
  if (status && status < 400) {
    console.log(`GET ${url} ${status}`);
    process.exit(0);
  }
  if (status) lastError = `HTTP ${status}`;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(`${url} did not answer: ${lastError}`);
process.exit(1);
