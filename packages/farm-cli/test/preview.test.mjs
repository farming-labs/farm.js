import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createPreviewTunnelPlan,
  parsePreviewPublicUrl,
  resolvePreviewTarget,
} = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("parses public preview urls from tunnel output", () => {
  assert.equal(
    parsePreviewPublicUrl("your url is: https://stripe-demo.preview.farming-labs.dev"),
    "https://stripe-demo.preview.farming-labs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl(
      "docs: https://developers.cloudflare.com\nready: https://stripe-demo.preview.farming-labs.dev",
      "stripe-demo.preview.farming-labs.dev",
    ),
    "https://stripe-demo.preview.farming-labs.dev",
  );
});

test("resolves a running local preview target", async () => {
  const server = await createTestServer();

  try {
    const target = await resolvePreviewTarget({
      port: server.port,
      timeoutMs: 1000,
    });

    assert.equal(target.localUrl, `http://localhost:${server.port}`);
    assert.equal(target.port, server.port);
    assert.equal(target.source, "port");
  } finally {
    await server.close();
  }
});

test("creates a tunnel plan from the preview command template", () => {
  const previousCommand = process.env.FARM_PREVIEW_TUNNEL_COMMAND;
  const previousDomain = process.env.FARM_PREVIEW_DOMAIN;
  process.env.FARM_PREVIEW_TUNNEL_COMMAND =
    "farm-preview-agent tunnel --url {url} --hostname {hostname}";
  process.env.FARM_PREVIEW_DOMAIN = "preview.farming-labs.dev";

  try {
    const plan = createPreviewTunnelPlan(
      {
        localUrl: "http://localhost:3000",
        host: "localhost",
        port: 3000,
        source: "port",
      },
      {
        name: "Stripe Webhook",
      },
    );

    assert.equal(plan.shell, true);
    assert.match(plan.command, /farm-preview-agent tunnel/);
    assert.match(plan.command, /"http:\/\/localhost:3000"/);
    assert.match(plan.command, /"stripe-webhook.preview.farming-labs.dev"/);
  } finally {
    restoreEnv("FARM_PREVIEW_TUNNEL_COMMAND", previousCommand);
    restoreEnv("FARM_PREVIEW_DOMAIN", previousDomain);
  }
});

test("runs farm preview dry-run through the CLI", async () => {
  const server = await createTestServer();

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliBin,
        "preview",
        "--port",
        String(server.port),
        "--name",
        "checkout-test",
        "--dry-run",
      ],
      {
        env: {
          ...process.env,
          FARM_PREVIEW_TUNNEL_COMMAND:
            "farm-preview-agent tunnel --url {url} --hostname {hostname}",
        },
      },
    );

    assert.match(stdout, /Creating public preview/);
    assert.match(stdout, new RegExp(`Local:\\s+http://localhost:${server.port}`));
    assert.match(stdout, /farm-preview-agent tunnel/);
    assert.match(stdout, /checkout-test\.preview\.farming-labs\.dev/);
    assert.match(stdout, /dry run completed/i);
  } finally {
    await server.close();
  }
});

async function createTestServer() {
  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
