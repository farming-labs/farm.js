// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const isWindows = process.platform === "win32";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const farmOTelRoot = path.resolve(packageRoot, "../farm-otel");

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(url: string, output: () => string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Production server did not start: ${String(lastError)}\n${output()}`);
}

describe("production OpenTelemetry tracing", () => {
  // Windows has no POSIX signals: child.kill("SIGTERM") maps to TerminateProcess,
  // so graceful shutdown never runs and its effects cannot be observed.
  it("starts instrumentation before traffic and flushes request traces during graceful shutdown", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-otel-"));
    const traceOutput = path.join(root, "traces.jsonl");
    let productionServer: ReturnType<typeof spawn> | undefined;

    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await fs.symlink(
        farmOTelRoot,
        path.join(root, "node_modules", "@farm.js", "otel"),
        "junction",
      );
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", "react")),
        path.join(root, "node_modules", "react"),
        "junction",
      );
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
        path.join(root, "node_modules", "react-dom"),
        "junction",
      );
      await fs.mkdir(path.join(root, "src", "app", "api", "health"), { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify(
          {
            private: true,
            type: "module",
            dependencies: {
              "@farm.js/core": "workspace:*",
              "@farm.js/otel": "workspace:*",
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
export default function Page() {
  return <main data-instrumentation={globalThis.__farmProductionInstrumentation}>production tracing</main>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "api", "health", "route.ts"),
        `export async function GET() { return Response.json({ ok: true }); }`,
      );
      await fs.writeFile(
        path.join(root, "src", "instrumentation.ts"),
        `
import { appendFileSync } from "node:fs";
import { registerOTel } from "@farm.js/otel";

const exporter = {
  export(spans, callback) {
    for (const span of spans) {
      appendFileSync(process.env.FARM_TRACE_OUTPUT, JSON.stringify({
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
        attributes: span.attributes,
        events: span.events.map((event) => event.name),
      }) + "\\n");
    }
    callback({ code: 0 });
  },
  async forceFlush() {},
  async shutdown() {},
};

export function register(context) {
  globalThis.__farmProductionInstrumentation = context.mode + ":" + context.runtime;
  return registerOTel({
    serviceName: "farm-production-test",
    autoInstrumentations: false,
    traceExporter: exporter,
  });
}
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          observability: { tracing: true },
          generateBuildId: () => "production-otel-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDirectory = path.join(root, ".farm", ".output", "server");
      const port = await getAvailablePort();
      const output: string[] = [];
      productionServer = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
        cwd: serverDirectory,
        env: {
          ...process.env,
          FARM_TRACE_OUTPUT: traceOutput,
          HOST: "127.0.0.1",
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      productionServer.stdout?.on("data", (chunk) => output.push(String(chunk)));
      productionServer.stderr?.on("data", (chunk) => output.push(String(chunk)));

      const response = await waitForServer(`http://127.0.0.1:${port}/`, () => output.join(""));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('data-instrumentation="production:nodejs"');

      const apiResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(apiResponse.status).toBe(200);
      expect(await apiResponse.json()).toEqual({ ok: true });

      productionServer.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Production shutdown timed out:\n${output.join("")}`)),
          8_000,
        );
        productionServer?.once("exit", (code, signal) => {
          clearTimeout(timeout);
          if (code && code !== 0) {
            reject(
              new Error(`Production server exited with ${code}/${signal}:\n${output.join("")}`),
            );
          } else resolve();
        });
      });
      productionServer = undefined;

      const spans = (await fs.readFile(traceOutput, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const requestSpan = spans.find((span) => span.name === "GET /");
      const renderSpan = spans.find((span) => span.name === "farm.render /");
      const apiRequestSpan = spans.find((span) => span.name === "GET /api/health");
      const apiSpan = spans.find((span) => span.name === "farm.api GET /api/health");
      expect(requestSpan).toMatchObject({
        attributes: {
          "http.request.method": "GET",
          "http.response.status_code": 200,
          "http.route": "/",
        },
      });
      expect(requestSpan.events).toEqual(
        expect.arrayContaining(["request.start", "route.matched", "request.complete"]),
      );
      expect(renderSpan.parentSpanId).toBe(requestSpan.spanId);
      expect(renderSpan.traceId).toBe(requestSpan.traceId);
      expect(apiRequestSpan).toMatchObject({
        attributes: {
          "http.request.method": "GET",
          "http.response.status_code": 200,
          "http.route": "/api/health",
        },
      });
      expect(apiRequestSpan.events).toEqual(
        expect.arrayContaining([
          "request.start",
          "route.matched",
          "api.request.start",
          "api.request.complete",
          "request.complete",
        ]),
      );
      expect(apiSpan.parentSpanId).toBe(apiRequestSpan.spanId);
      expect(apiSpan.traceId).toBe(apiRequestSpan.traceId);
    } finally {
      if (productionServer && productionServer.exitCode === null) {
        productionServer.kill("SIGKILL");
      }
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 120_000);
});
