// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer, type ProductionServer } from "./production-server";

const isWindows = process.platform === "win32";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const farmOTelRoot = path.resolve(packageRoot, "../farm-otel");

describe("production OpenTelemetry tracing", () => {
  // Windows has no POSIX signals: child.kill("SIGTERM") maps to TerminateProcess,
  // so graceful shutdown never runs and its effects cannot be observed.
  it("starts instrumentation before traffic and flushes request traces during graceful shutdown", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-otel-"));
    const traceOutput = path.join(root, "traces.jsonl");
    let productionServer: ProductionServer | undefined;

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

      productionServer = await startProductionServer(
        path.join(root, ".farm", ".output", "server"),
        { env: { FARM_TRACE_OUTPUT: traceOutput } },
      );
      const { origin, output, process: serverProcess } = productionServer;

      const response = await fetch(`${origin}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('data-instrumentation="production:nodejs"');

      const apiResponse = await fetch(`${origin}/api/health`);
      expect(apiResponse.status).toBe(200);
      expect(await apiResponse.json()).toEqual({ ok: true });

      serverProcess.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Production shutdown timed out:\n${output()}`)),
          8_000,
        );
        serverProcess.once("exit", (code, signal) => {
          clearTimeout(timeout);
          if (code && code !== 0) {
            reject(new Error(`Production server exited with ${code}/${signal}:\n${output()}`));
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
      await productionServer?.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 120_000);
});
