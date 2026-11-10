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
  options: { bodySizeLimit?: number | string; farmMiddleware?: unknown } = {},
): Promise<(req: any, res: any, next: any) => Promise<void>> {
  const { farmMiddleware, ...pluginOptions } = options;
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
    environments: {
      ssr: {
        runner: {
          import: vi.fn(async (filePath: string) =>
            filePath === path.join(root, ECHO_ROUTE_FILE) ? endpointModule : {},
          ),
        },
      },
    },
    moduleGraph: { invalidateModule: vi.fn() },
    __farmMiddleware__: farmMiddleware,
  };

  const plugin = farmApi({ srcDir: "src", ...pluginOptions });
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

/** What the dev middleware sent: the status, the Content-Type, and the body. */
function readSentResponse(res: ReturnType<typeof makeResponse>) {
  const chunks = [...res.write.mock.calls, ...res.end.mock.calls]
    .map((call: unknown[]) => call[0])
    .filter((chunk) => chunk !== undefined && typeof chunk !== "function")
    .map((chunk) => Buffer.from(chunk as Uint8Array | string));
  const contentType = res.setHeader.mock.calls.find(
    ([name]: unknown[]) => String(name).toLowerCase() === "content-type",
  )?.[1];
  return { status: res.statusCode, contentType, body: Buffer.concat(chunks).toString("utf8") };
}

const INTERNAL_SERVER_ERROR = {
  status: 500,
  contentType: "application/json",
  body: '{"error":"Internal Server Error"}',
};

it("answers a throwing route with core's generic 500 and keeps the message in the log", async () => {
  await withTempRoot(async (root) => {
    const middleware = await createHarness(root, {
      POST: async () => {
        throw new Error("route-secret-detail");
      },
    });
    const res = makeResponse();
    await middleware(makeRequest(Buffer.from("{}"), { method: "POST" }), res, vi.fn());

    expect(readSentResponse(res)).toEqual(INTERNAL_SERVER_ERROR);
    expect(console.error).toHaveBeenCalledWith(
      "[API Error] /api/echo:",
      expect.objectContaining({ message: "route-secret-detail" }),
    );
  });
});

it("answers a throwing app middleware with core's generic 500", async () => {
  await withTempRoot(async (root) => {
    const endpoint = vi.fn(async () => new Response("ok"));
    const middleware = await createHarness(
      root,
      { POST: endpoint },
      {
        farmMiddleware: {
          execute: async () => {
            throw new Error("middleware-secret-detail");
          },
        },
      },
    );
    const res = makeResponse();
    await middleware(makeRequest(Buffer.from("{}"), { method: "POST" }), res, vi.fn());

    expect(endpoint).not.toHaveBeenCalled();
    expect(readSentResponse(res)).toEqual(INTERNAL_SERVER_ERROR);
  });
});
