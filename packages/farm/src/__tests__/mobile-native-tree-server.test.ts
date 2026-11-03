// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = new Set<string>();
const servers = new Set<ViteDevServer>();
const NATIVE = "application/vnd.farm.native+json";

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...roots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  roots.clear();
});

const MOBILE = { id: "com.example.notes", server: "https://notes.example.com" };

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-native-tree-"));
  roots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"private":true,"type":"module"}',
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <div><nav>chrome</nav>{children}</div>; }",
    // An async page: its data loads on the server, as for the web page.
    "src/app/notes/page.tsx": `export const mobile = { native: true };
async function load() { return [{ id: 1, title: "First" }, { id: 2, title: "Second" }]; }
export default async function Notes() {
  const notes = await load();
  return (
    <main className="flex flex-col gap-2 p-4">
      <h1 className="text-2xl font-bold">Notes</h1>
      <ul>{notes.map((note) => <li key={note.id}><a href={"/notes/" + note.id}>{note.title}</a></li>)}</ul>
    </main>
  );
}
`,
  };
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

function expectNotesTree(tree: any) {
  expect(tree.unsupported).toEqual([]);
  expect(JSON.stringify(tree)).not.toContain("chrome");
  const main = tree.root.children[0];
  expect(main).toMatchObject({ type: "View", tag: "main", style: { rowGap: 8 } });
  expect(main.children[0]).toMatchObject({ type: "Text", tag: "h1", children: ["Notes"] });
  const links = main.children[1].children.map((item: any) => item.children[0].children[0]);
  expect(links).toEqual([
    expect.objectContaining({ href: "https://notes.example.com/notes/1", children: ["First"] }),
    expect.objectContaining({ href: "https://notes.example.com/notes/2", children: ["Second"] }),
  ]);
}

describe("native tier screens from the web server", () => {
  it("answers in development, and only for apps with a mobile block", async () => {
    const root = await createApp();
    const start = async (config: object) => {
      const server = await createServer({ root, images: { provider: "none" }, ...config });
      servers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      return `http://localhost:${address.port}`;
    };

    const origin = await start({ mobile: MOBILE });
    const response = await fetch(`${origin}/notes`, {
      headers: { accept: NATIVE },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(`${NATIVE}; charset=utf-8`);
    const tree = await response.json();
    expectNotesTree({
      ...tree,
      // The dev server answers on localhost.
      root: JSON.parse(JSON.stringify(tree.root).replaceAll(origin, "https://notes.example.com")),
    });
    // The web page itself is unchanged.
    expect(await fetch(`${origin}/notes`).then((page) => page.text())).toContain(
      "<nav>chrome</nav>",
    );

    const web = await start({});
    const plain = await fetch(`${web}/notes`, { headers: { accept: NATIVE } });
    expect(plain.headers.get("content-type")).toContain("text/html");
  }, 60_000);

  it("answers from the production server", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
        mobile: MOBILE,
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionRoot = path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func");
    const { default: handler } = await import(
      /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
    );
    const response = await handler.fetch(
      new Request("https://notes.example.com/notes", { headers: { accept: NATIVE } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(`${NATIVE}; charset=utf-8`);
    expectNotesTree(await response.json());
    const page = await handler.fetch(new Request("https://notes.example.com/notes"));
    expect(await page.text()).toContain("<nav>chrome</nav>");
  }, 120_000);

  it("adds nothing to the production server of an app without a mobile block", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionRoot = path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func");
    const sources = await Promise.all(
      (await fs.readdir(functionRoot, { recursive: true }))
        .filter((file) => file.endsWith(".mjs"))
        .map((file) => fs.readFile(path.join(functionRoot, file), "utf8")),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toContain(NATIVE);
      expect(source).not.toContain("createFarmNativeTree");
    }
  }, 120_000);
});
