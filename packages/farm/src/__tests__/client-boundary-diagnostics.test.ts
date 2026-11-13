// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

// A client component whose TypeScript the compiler strips before Farm's transform sees it, so the
// positions below only come out right when they are mapped back to this source.
const WIDGET = `"use client";
import type { ReactNode } from "react";
import fs from "fs";
import { emit } from "events";

interface Props {
  label: string;
  children?: ReactNode;
}

const secret = process.env.DATABASE_URL;
const { API_KEY } = process.env;

export default function Widget(props: Props) {
  return <p>{props.label}{String(Boolean(fs) && emit && secret && API_KEY)}</p>;
}
`;

const FILES: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "farm.config.ts": "export default { images: { provider: 'none' }, telemetry: false };",
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `import Widget from "./widget";
export default function Page() { return <Widget label="hi" />; }`,
  "src/app/widget.tsx": WIDGET,
  // A browser package installed under a builtin's name is real code, not Farm's stub.
  "node_modules/events/package.json": '{"name":"events","version":"3.3.0","main":"index.js"}',
  "node_modules/events/index.js": "export const emit = () => {};",
};

async function createApp(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

/** The first line of each client-boundary diagnostic the run printed. */
function reportedDiagnostics(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls
    .flatMap((call) => String(call[0]).split("\n"))
    .filter((line) => /- (warning|error) CLIENT_/.test(line))
    .map((line) => line.replace(/^.*?(?=src\/app\/)/, ""));
}

const EXPECTED = [
  'src/app/widget.tsx:3:1 - warning CLIENT_NODE_BUILTIN: "fs" is imported into a module compiled for the browser',
  "src/app/widget.tsx:11:16 - warning CLIENT_SERVER_ENV: process.env.DATABASE_URL is read at module scope",
  "src/app/widget.tsx:12:9 - warning CLIENT_SERVER_ENV: process.env.API_KEY is read at module scope",
];

function expectDiagnostics(lines: string[]) {
  expect(lines).toHaveLength(EXPECTED.length);
  EXPECTED.forEach((expected, index) => expect(lines[index]).toContain(expected));
}

describe("client-boundary diagnostics name the source position of a TSX client component", () => {
  it("in development", async () => {
    const warn = vi.spyOn(console, "warn");
    const root = await createApp("farm-dev-client-boundary-");
    const server = await createServer({ root });
    devServers.add(server);
    await server.environments.client.transformRequest("/src/app/widget.tsx");
    expectDiagnostics(reportedDiagnostics(warn));
  }, 120_000);

  it("in a production build", async () => {
    const warn = vi.spyOn(console, "warn");
    const root = await createApp("farm-prod-client-boundary-");
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    expectDiagnostics(reportedDiagnostics(warn));
  }, 240_000);
});
