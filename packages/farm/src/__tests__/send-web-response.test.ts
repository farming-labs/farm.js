// @vitest-environment node

import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { sendWebResponse } from "../server/response";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

function createChunkStream(chunkCount: number, chunkBytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= chunkCount) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(120));
    },
  });
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("sendWebResponse", () => {
  it("settles when the client disconnects mid-stream under backpressure", async () => {
    let handlerSettled: "pending" | "returned" | "threw" = "pending";
    const server = createServer((_req, res) => {
      void sendWebResponse(
        res,
        new Response(createChunkStream(2_000, 64 * 1024), {
          headers: { "content-type": "application/octet-stream" },
        }),
      ).then(
        () => {
          handlerSettled = "returned";
        },
        () => {
          handlerSettled = "threw";
        },
      );
    });
    const port = await listen(server);

    // Read one chunk, then vanish — the closed-tab / cancelled-download case.
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
      });
      socket.once("data", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    });

    // The old code awaited a drain that never comes and stayed pending forever.
    const deadline = Date.now() + 5_000;
    while (handlerSettled === "pending" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(handlerSettled).toBe("returned");
  });

  it("delivers complete bodies to clients that read normally", async () => {
    const chunkCount = 64;
    const chunkBytes = 16 * 1024;
    const server = createServer((_req, res) => {
      void sendWebResponse(
        res,
        new Response(createChunkStream(chunkCount, chunkBytes), {
          headers: { "content-type": "application/octet-stream" },
        }),
      );
    });
    const port = await listen(server);

    const received = await fetch(`http://127.0.0.1:${port}/`).then((response) =>
      response.arrayBuffer(),
    );
    expect(received.byteLength).toBe(chunkCount * chunkBytes);
  });
});
