// @vitest-environment node

import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

// Stands in for a built `.output/server/index.mjs`: it binds HOST:PORT, prints the entry's
// `Listening on` line once bound, and exits with the listen error otherwise.
const ENTRY = `
import { createServer } from "node:http";
const server = createServer((request, response) => response.end("app " + request.url));
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
server.listen(Number(process.env.PORT), process.env.HOST, () => {
  const { address, port } = server.address();
  console.log("Listening on http://" + address + ":" + port);
});
`;

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function createEntry(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-server-helper-"));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "index.mjs"), ENTRY);
  return directory;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
}

describe("startProductionServer", () => {
  it("does not take another server on the picked port for the production server", async () => {
    const directory = await createEntry();
    // Another test file's mock upstream bound the port between the pick and the spawn.
    const takenPort = await getAvailablePort();
    await listen(
      createServer((request, response) =>
        response.end(`upstream ${request.method} ${request.url}`),
      ),
      takenPort,
    );
    const ports = [takenPort];

    const production = await startProductionServer(directory, {
      getPort: async () => ports.shift() ?? getAvailablePort(),
    });
    cleanup.push(() => production.stop());

    expect(production.port).not.toBe(takenPort);
    await expect((await fetch(`${production.origin}/ppr-page`)).text()).resolves.toBe(
      "app /ppr-page",
    );
  });

  it("reports an entry that exits before it listens, with its output", async () => {
    const directory = await createEntry();
    await fs.writeFile(
      path.join(directory, "index.mjs"),
      `console.error("boom"); process.exit(3);`,
    );

    await expect(startProductionServer(directory)).rejects.toThrow(
      /exited \(3\) before listening[\s\S]*boom/,
    );
  });

  it("reports a runtime that cannot be spawned", async () => {
    const directory = await createEntry();

    await expect(
      startProductionServer(directory, { command: path.join(directory, "missing-runtime") }),
    ).rejects.toThrow(/failed to spawn/);
  });

  it("stops the server and waits for it to exit", async () => {
    const production = await startProductionServer(await createEntry());
    await production.stop();

    expect(production.process.exitCode ?? production.process.signalCode).not.toBeNull();
    await expect(fetch(production.origin)).rejects.toThrow();
  });
});

describe("getAvailablePort", () => {
  it("picks ports that listen(0) is never assigned", async () => {
    // Linux assigns listen(0) ports from 32768 up, Windows and macOS from 49152 up.
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(await getAvailablePort()).toBeLessThan(32_768);
    }
  });
});

// A test that polls a spawned production entry with fetch can read another test's server on its
// port. These files start a server the helper cannot wait for, or wait for their child's output.
const OWN_READINESS: Record<string, string> = {
  "desktop-runtime.test.ts": "a desktop server binds its own ephemeral port and ignores PORT",
  "development-ssr-prebundle.test.ts": "it spawns a development server script, not a built entry",
  "mobile-client-build.test.ts": "it waits for its child to print the port it listens on",
  "mobile-session-runtime.test.ts": "it waits for its child's own Listening on line",
  "mobile-rsc-build.test.ts": "the RSC entry prints no listen line under vitest",
  "rsc-server-plugins-build.test.ts": "the RSC entry prints no listen line under vitest",
};

describe("production server tests", () => {
  it("start a built entry through startProductionServer", async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const files = (await fs.readdir(directory)).sort();
    for (const file of Object.keys(OWN_READINESS)) expect(files).toContain(file);
    const polling: string[] = [];
    for (const file of files) {
      if (!/\.tsx?$/.test(file) || file in OWN_READINESS || file.startsWith("production-server.")) {
        continue;
      }
      const source = await fs.readFile(path.join(directory, file), "utf8");
      const startsEntry = /\bspawn\(/.test(source) && /["'`/]index\.mjs["'`]/.test(source);
      if (startsEntry && !source.includes('from "./production-server"')) polling.push(file);
    }
    expect(polling).toEqual([]);
  });
});
