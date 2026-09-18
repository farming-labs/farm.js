import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import farmApi from "./index.js";

type Endpoint = (request: Request) => Promise<Response>;

const ECHO_ROUTE_DIR = path.join("src", "api", "echo");
const ECHO_ROUTE_FILE = path.join("src", "api", "echo", "route.ts");

async function createHarness(
  root: string,
  endpointModule: Record<string, Endpoint>,
  options: { bodySizeLimit?: number | string } = {},
): Promise<(req: any, res: any, next: any) => Promise<void>> {
  mkdirSync(path.join(root, ECHO_ROUTE_DIR), { recursive: true });
  writeFileSync(path.join(root, ECHO_ROUTE_FILE), "export const POST = () => new Response('ok');");

  let middleware!: (req: any, res: any, next: any) => Promise<void>;
  const server = {
    config: { root, publicDir: path.join(root, "public") },
    middlewares: {
      use(handler: (req: any, res: any, next: any) => Promise<void>) {
        middleware = handler;
      },
    },
    ssrLoadModule: vi.fn(async (filePath: string) =>
      filePath === path.join(root, ECHO_ROUTE_FILE) ? endpointModule : {},
    ),
    moduleGraph: { invalidateModule: vi.fn() },
  };

  const plugin = farmApi({ srcDir: "src", ...options });
  const setup = plugin.configureServer!(server as any) as () => void;
  setup();
  await (server as any).__farmApi__.waitForDiscovery();
  return middleware;
}

function makeRequest(
  payload: Buffer,
  init: {
    method: string;
    headers?: Record<string, string>;
  },
) {
  return Object.assign(Readable.from([payload.subarray(0, 1), payload.subarray(1)]), {
    method: init.method,
    url: "/api/echo",
    headers: { host: "farm.test", ...init.headers },
  });
}

function makeResponse() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
  });
}

async function withTempRoot(action: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-api-body-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await action(root);
  } finally {
    log.mockRestore();
    errorSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}

it("preserves raw binary request bytes through the /api dev middleware", async () => {
  await withTempRoot(async (root) => {
    const payload = Buffer.from([0, 255, 240, 128, 10]);
    let received: Buffer | undefined;
    const endpoint = vi.fn(async (request: Request) => {
      received = Buffer.from(await request.arrayBuffer());
      return new Response("ok");
    });
    const middleware = await createHarness(root, { POST: endpoint, PUT: endpoint });

    const req = makeRequest(payload, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(payload.length),
      },
    });
    await middleware(req, makeResponse(), vi.fn());

    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(received).toEqual(payload);
    expect(req.listenerCount("data")).toBe(0);
    expect(req.listenerCount("end")).toBe(0);
  });
});

it("preserves multipart/form-data file field bytes", async () => {
  await withTempRoot(async (root) => {
    const fileBytes = Buffer.from([0, 255, 240, 128, 10]);
    const payload = Buffer.concat([
      Buffer.from(
        '--test\r\nContent-Disposition: form-data; name="file"; filename="f.bin"\r\nContent-Type: application/octet-stream\r\n\r\n',
      ),
      fileBytes,
      Buffer.from("\r\n--test--\r\n"),
    ]);
    let receivedFile: Buffer | undefined;
    const endpoint = vi.fn(async (request: Request) => {
      const form = await request.formData();
      receivedFile = Buffer.from(await (form.get("file") as File).arrayBuffer());
      return new Response("ok");
    });
    const middleware = await createHarness(root, { POST: endpoint });

    const req = makeRequest(payload, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test",
        "content-length": String(payload.length),
      },
    });
    await middleware(req, makeResponse(), vi.fn());

    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(receivedFile).toEqual(fileBytes);
  });
});

it("rejects an oversized body with 413 and enforces the body-size limit", async () => {
  await withTempRoot(async (root) => {
    const payload = Buffer.from([0, 255, 240, 128, 10]);
    const endpoint = vi.fn(async () => new Response("ok"));
    const middleware = await createHarness(root, { POST: endpoint }, { bodySizeLimit: 2 });

    const req = makeRequest(payload, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
    });
    const res = makeResponse();
    await middleware(req, res, vi.fn());

    expect(res.statusCode).toBe(413);
    expect(endpoint).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
  });
});
