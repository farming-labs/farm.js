import { createServer } from "node:http";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RecordedRequest, RecordingServer } from "./types.js";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function startRecordingServer(
  respond: (request: RecordedRequest, response: ServerResponse) => void,
): Promise<RecordingServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const recorded = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body: await readBody(request),
    };
    requests.push(recorded);
    respond(recorded, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
