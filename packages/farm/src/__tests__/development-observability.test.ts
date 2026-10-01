// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const farmOTelRoot = path.resolve(packageRoot, "../farm-otel");

async function getAvailablePort(): Promise<number> {
  const server = createNetServer();
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

async function waitForServerReady(
  child: ReturnType<typeof spawn>,
  output: () => string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message: unknown) => {
      if (message === "farm:test:ready") finish();
    };
    const onError = (error: Error) =>
      finish(new Error(`Development server failed to start: ${error.message}\n${output()}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(
          `Development server exited before it was ready (${code}/${signal}):\n${output()}`,
        ),
      );
    const timeout = setTimeout(
      () => finish(new Error(`Development server readiness timed out:\n${output()}`)),
      30_000,
    );

    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

describe("development OpenTelemetry tracing", () => {
  // Windows has no POSIX signals: child.kill("SIGTERM") maps to TerminateProcess,
  // so graceful shutdown never runs and its effects cannot be observed.
  it("starts instrumentation before traffic and flushes request traces on server close", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-otel-"));
    const traceOutput = path.join(root, "traces.jsonl");
    let developmentServer: ReturnType<typeof spawn> | undefined;

    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
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
      await fs.mkdir(path.join(root, "src", "app", "api", "failure"), { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ private: true, type: "module" }, null, 2),
      );
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `import React from "react"; export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `import React from "react"; export default function Page() { return <main data-instrumentation={globalThis.__farmDevelopmentInstrumentation}>development tracing</main>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "api", "failure", "route.ts"),
        `export async function GET() { throw new Error("development API failure"); }`,
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
        attributes: span.attributes,
        events: span.events.map((event) => event.name),
      }) + "\\n");
    }
    callback({ code: 0 });
  },
  async shutdown() {},
};

export function register(context) {
  globalThis.__farmDevelopmentInstrumentation = context.mode + ":" + context.runtime;
  return registerOTel({
    serviceName: "farm-development-test",
    autoInstrumentations: false,
    traceExporter: exporter,
  });
}
`.trim(),
      );

      const port = await getAvailablePort();
      const startFile = path.join(root, "start.mjs");
      await fs.writeFile(
        startFile,
        `
import { createServer } from ${JSON.stringify(
          pathToFileURL(path.join(packageRoot, "dist", "server.mjs")).href,
        )};

const server = await createServer({
  root: process.cwd(),
  srcDir: "src",
  images: { provider: "none" },
  observability: { tracing: true },
});
process.once("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
await server.listen(Number(process.env.PORT));
process.send?.("farm:test:ready");
`.trim(),
      );

      const output: string[] = [];
      developmentServer = spawn(process.execPath, [startFile], {
        cwd: root,
        env: {
          ...process.env,
          FARM_TRACE_OUTPUT: traceOutput,
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      developmentServer.stdout?.on("data", (chunk) => output.push(String(chunk)));
      developmentServer.stderr?.on("data", (chunk) => output.push(String(chunk)));

      await waitForServerReady(developmentServer, () => output.join(""));
      const request = async (pathname: string) => {
        try {
          return await fetch(`http://localhost:${port}${pathname}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Development request to ${pathname} failed: ${message}\n${output.join("")}`,
          );
        }
      };
      const response = await request("/");
      const body = await response.text();
      if (response.status !== 200) {
        throw new Error(
          `Development request failed with ${response.status}:\n${body}\n${output.join("")}`,
        );
      }
      expect(body).toContain('data-instrumentation="development:nodejs"');

      const apiResponse = await request("/api/failure");
      expect(apiResponse.status).toBe(500);
      await expect(apiResponse.json()).resolves.toEqual({ error: "Internal server error" });

      developmentServer.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Development shutdown timed out:\n${output.join("")}`)),
          8_000,
        );
        developmentServer?.once("exit", (code, signal) => {
          clearTimeout(timeout);
          if (code && code !== 0) {
            reject(
              new Error(`Development server exited with ${code}/${signal}:\n${output.join("")}`),
            );
          } else resolve();
        });
      });
      developmentServer = undefined;

      const spans = (await fs.readFile(traceOutput, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const requestSpan = spans.find((span) => span.name === "GET /");
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
      const failedApiRequestSpan = spans.find((span) => span.name === "GET /api/failure");
      expect(failedApiRequestSpan).toMatchObject({
        attributes: {
          "http.request.method": "GET",
          "http.response.status_code": 500,
          "http.route": "/api/failure",
        },
      });
      expect(failedApiRequestSpan.events).toContain("api.error");
      expect(failedApiRequestSpan.events).not.toContain("api.request.complete");
    } finally {
      if (developmentServer && developmentServer.exitCode === null) {
        developmentServer.kill("SIGKILL");
      }
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 60_000);
});
