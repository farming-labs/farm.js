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
