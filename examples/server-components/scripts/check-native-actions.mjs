// Server actions on a native-tier screen (RFC 0004), against the production server:
// `node scripts/check-native-actions.mjs <rsc|islands>`. It builds with `--mobile`, then sends the
// requests the app's shell sends: /native's tree, each form's server action posted as the shell
// posts it (multipart, the page's Origin, the native-tree Accept), and the redrawn result.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "islands" ? "islands" : "rsc";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TREE = "application/vnd.farm.native+json";
const env = { ...process.env, FARM_SERVER_COMPONENTS_MODE: mode, FARM_SKIP_RSC_INSTALL: "1" };

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`${command} ${args.join(" ")}:\n${output}`)),
    );
  });
}

const freePort = () =>
  new Promise((resolvePort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });

await run("pnpm", ["exec", "farm", "build", "--mobile"]);
const manifest = JSON.parse(
  await readFile(join(root, ".farm/output/mobile/farm-routes.json"), "utf8"),
);
assert.equal(
  manifest.rules.find((rule) => rule.route === "/native")?.screen,
  "server",
  "/native must be a native-tier (server) screen",
);

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn("node", [".farm/output/mobile/www/server/index.mjs"], {
  cwd: root,
  env: { ...env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${origin}/`)).ok) break;
    } catch {}
    if (attempt > 60) throw new Error(`The server did not start:\n${serverLog}`);
    await sleep(500);
  }

  const tree = async (response) => {
    assert.match(response.headers.get("content-type") ?? "", /vnd\.farm\.native\+json/);
    const body = await response.json();
    assert.deepEqual(body.unsupported, [], "the tree must draw everything natively");
    return body;
  };
  const text = (node) =>
    typeof node === "string" ? node : (node.children ?? []).map(text).join(" ");
  const forms = (node, found = []) => {
    if (node && typeof node === "object") {
      if (node.form) found.push(node);
      for (const child of node.children ?? []) forms(child, found);
    }
    return found;
  };
  /** Posts a form as the shell does: its hidden fields, the typed fields, multipart. */
  const submit = (form, typed) => {
    const body = new FormData();
    for (const field of form.form.fields ?? []) body.append(field.name, field.value);
    for (const [name, value] of Object.entries(typed)) body.append(name, value);
    return fetch(form.form.action, {
      method: "POST",
      redirect: "manual",
      headers: { accept: TREE, origin },
      body,
    });
  };

  const page = await tree(await fetch(`${origin}/native`, { headers: { accept: TREE } }));
  assert.match(text(page.root), /Native notes/);
  assert.doesNotMatch(text(page.root), /Contract pages|Children/, "only the page, not the layout");
  const [redirecting, inline] = forms(page.root);
  assert.ok(redirecting && inline, "both forms are drawn");
  assert.ok(
    // React names them $ACTION_ID_…; islx $F_REF_n and $F_n:A.
    redirecting.form.fields?.some((field) => field.name.startsWith("$")),
    "the server action's reference travels as hidden fields",
  );

  // A server action that redirects: post/redirect/get, which the shell follows.
  const posted = await submit(redirecting, { title: `From the app (${mode})` });
  assert.equal(posted.status, 303, `the redirecting action answers 303, got ${posted.status}`);
  assert.equal(new URL(posted.headers.get("location"), origin).pathname, "/native");
  const after = await tree(await fetch(`${origin}/native`, { headers: { accept: TREE } }));
  assert.match(text(after.root), new RegExp(`From the app \\(${mode}\\)`));

  // An inline server action: RSC renders the page again with its result (200, a tree); islx
  // redirects back to it (303), which the shell loads in place. Either way the result shows.
  const rendered = await submit(inline, { title: `Inline (${mode})` });
  let result;
  if (rendered.status === 303) {
    assert.equal(new URL(rendered.headers.get("location"), origin).pathname, "/native");
    result = await tree(await fetch(`${origin}/native`, { headers: { accept: TREE } }));
  } else {
    assert.equal(rendered.status, 200, `the inline action answers 200 or 303, got ${rendered.status}`);
    result = await tree(rendered);
  }
  assert.match(text(result.root), new RegExp(`Inline \\(${mode}\\) \\(urgent\\)`));

  // Only the server's own render marks the page: a browser that sends the header gets the same
  // page as one that does not (islx always marks it; RSC marks only the tree's render).
  const marks = async (headers) =>
    ((await (await fetch(`${origin}/native`, { headers })).text()).match(/__farm_page__/g) ?? [])
      .length;
  assert.equal(await marks({ "x-farm-native-tree": "1" }), await marks({}));

  console.log(`Server actions run from the native screen (${mode}).`);
} finally {
  server.kill();
}
