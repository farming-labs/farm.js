// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

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
  throw new Error(`Development server did not start: ${String(lastError)}\n${output()}`);
}

describe("development OpenTelemetry tracing", () => {
  it("starts instrumentation before traffic and flushes request traces on server close", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-otel-"));
    const traceOutput = path.join(root, "traces.jsonl");
    let developmentServer: ReturnType<typeof spawn> | undefined;

    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(farmOTelRoot, path.join(root, "node_modules", "@farm.js", "otel"), "dir");
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", "react")),
        path.join(root, "node_modules", "react"),
        "dir",
      );
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
        path.join(root, "node_modules", "react-dom"),
        "dir",
      );
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
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
        stdio: ["ignore", "pipe", "pipe"],
      });
      developmentServer.stdout?.on("data", (chunk) => output.push(String(chunk)));
      developmentServer.stderr?.on("data", (chunk) => output.push(String(chunk)));

      const response = await waitForServer(`http://localhost:${port}/`, () => output.join(""));
      const body = await response.text();
      if (response.status !== 200) {
        throw new Error(
          `Development request failed with ${response.status}:\n${body}\n${output.join("")}`,
        );
      }
      expect(body).toContain('data-instrumentation="development:nodejs"');

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
    } finally {
      if (developmentServer && developmentServer.exitCode === null) {
        developmentServer.kill("SIGKILL");
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
