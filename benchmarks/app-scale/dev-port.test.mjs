import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";
import { devPortOpen } from "./dev-port.mjs";

test("a temporary Vite listener cannot start the first page measurement", async (t) => {
  const server = net.createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  assert.equal(await devPortOpen(port, []), false);
  assert.equal(await devPortOpen(port, ["Local: http://localhost:1/\n"]), false);
  assert.equal(await devPortOpen(port, ["  ➜  Local:   http://local", `host:${port}/\n`]), true);
});
