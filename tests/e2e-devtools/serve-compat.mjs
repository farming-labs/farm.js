import { startDevServer } from "../../packages/farm/dist/server.mjs";
import { createServer } from "node:net";

// A separate process keeps each renderer's module cache and dependency optimizer isolated.
// Vite 5 treats port 0 as its default port, so obtain a free concrete port first.
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const server = await startDevServer({ root: process.cwd() }, port);
const address = server.httpServer.address();
let closing;
const close = () => (closing ??= server.close().then(() => process.exit(0)));
process.once("disconnect", close);
process.once("message", (message) => {
  if (message === "close") void close();
});
if (process.connected) process.send({ port: address.port });
else await close();
