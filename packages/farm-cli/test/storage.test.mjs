import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
const core = fileURLToPath(new URL("../../farm/", import.meta.url));

test("storage plan is local and apply reconciles each named database once", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-storage-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scope = path.join(root, "node_modules", "@farm.js");
  await mkdir(scope, { recursive: true });
  await symlink(core, path.join(scope, "core"), "junction");
  await writeFile(
    path.join(root, "farm.config.ts"),
    `
    import { farmStorage, sqliteStorage, redisStorage, postgresStorage, memoryStorage } from "@farm.js/core/storage";
    export default {storage: {mounts: {
      editor: sqliteStorage({managed:{name:"drafts"}}),
      drafts: sqliteStorage({managed:true}),
      copy: farmStorage({namespace:"drafts"}),
      orders: postgresStorage({managed:true}),
      cache: redisStorage({managed:true, namespace:"sessions"}),
      sessions: {driver:"cloudflare-kv-binding", managed:true},
      raw: {driver:"redis", managed:true, namespace:"raw-only"},
      external: postgresStorage({}),
      ephemeral: memoryStorage()
    }}};
  `,
  );
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    received.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      environment: req.headers["x-farm-environment"],
      body,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: body.name }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = {
    ...process.env,
    FARMJS_API_URL: `http://127.0.0.1:${server.address().port}`,
    FARMJS_API_KEY: "",
    FARMJS_ENVIRONMENT: "development",
  };
  const command = (action) =>
    run(process.execPath, [cli, "storage", action, "--root", root], { env });
  const names = ["drafts", "orders", "raw-only", "sessions"];
  const plan = await command("plan");
  assert.deepEqual(
    [...plan.stdout.matchAll(/Ensure SQLite: ([a-z-]+)/g)].map((m) => m[1]),
    names,
  );
  assert.deepEqual(received, []);
  await assert.rejects(command("apply"), /FARMJS_API_KEY/);
  assert.deepEqual(received, []);
  delete env.FARMJS_API_KEY;
  await writeFile(path.join(root, ".env.local"), "FARMJS_API_KEY=fixture\n");
  assert.match((await command("apply")).stdout, /Ready: drafts/);
  assert.deepEqual(
    received,
    names.map((name) => ({
      method: "PUT",
      path: "/api/storage/sqlite/provision",
      authorization: "Bearer fixture",
      environment: "development",
      body: { name },
    })),
  );
});

test("generates the ORM model types from each configured mount", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "farm-storage-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const modules = path.join(root, "node_modules");
  await mkdir(path.join(modules, "@farm.js"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await symlink(core, path.join(modules, "@farm.js/core"), "junction");
  await symlink(
    path.join(core, "node_modules/@farming-labs"),
    path.join(modules, "@farming-labs"),
    "junction",
  );
  await mkdir(path.join(root, "base"));
  await writeFile(
    path.join(root, "base/farm.config.ts"),
    `
    import { farmStorage } from "@farm.js/core/storage";
    import { defineSchema, id, model } from "@farming-labs/orm";
    const schema = defineSchema({ note: model({ table: "notes", fields: { id: id() } }) });
    export default { storage: { mounts: { inherited: farmStorage({schema}), plain: farmStorage({schema}) } } };
  `,
  );
  await writeFile(
    path.join(root, "farm.config.ts"),
    `
    import { defineConfig } from "@farm.js/core";
    import { farmStorage, redisStorage } from "@farm.js/core/storage";
    import { defineSchema, id, model } from "@farming-labs/orm";
    const schema = defineSchema({ draft: model({ table: "drafts", fields: { id: id() }, relations: {} }) });
    const optionalSchema = (enabled: boolean) => enabled ? schema : undefined;
    export default defineConfig({ extends: ["./base"], storage: { mounts: {
      drafts: farmStorage({ schema }), editor: redisStorage({ managed: true, schema }), plain: farmStorage(),
      optional: farmStorage({schema: optionalSchema(false)})
    } } });
  `,
  );
  await writeFile(
    path.join(root, "src/use.ts"),
    `
    import { getDatabase } from "@farm.js/core/storage";
    export async function check(name: string) {
      const db = await getDatabase("drafts");
      const rows: { id: string }[] = await db.draft.findMany({ select: { id: true } });
      // @ts-expect-error Only configured models are available.
      db.order.findMany();
      // @ts-expect-error Only fields of the model are selectable.
      db.draft.findMany({ select: { title: true } });
      (await getDatabase("editor")).draft.findMany();
      (await getDatabase("inherited")).note.findMany();
      (await getDatabase("plain")).execute("select 1");
      const optional = await getDatabase("optional");
      // @ts-expect-error Conditional schemas require narrowing or an explicit raw lookup.
      optional.execute("select 1");
      (await getDatabase(name, { raw: true })).execute("select 1");
      return rows;
    }
  `,
  );
  await run(process.execPath, [cli, "generate", "--root", root]);
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
  await run(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "src/farm.d.ts",
      "src/use.ts",
    ],
    { cwd: root },
  );
});
