import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run the real function outside the checkout. Otherwise Node can resolve a
// missing deployment dependency from the workspace and hide a cold-start crash.
if (process.argv[2] === "--function") {
  const { default: handler } = await import(pathToFileURL(process.argv[3]).href);
  for (const [pathname, content] of [
    ["/", "Farm"],
    ["/docs", 'id="nd-docs-layout"'],
    ["/docs/upgrading", "Upgrading"],
    ["/blog", "Farm"],
    ["/blog/0.1.0", "0.1"],
    ["/agents", "waitlist"],
    ["/r/button.json", "registry:ui"],
  ]) {
    const response = await handler.fetch(new Request(`https://farmjs.dev${pathname}`));
    assert.equal(response.status, 200, `${pathname} must render`);
    assert.ok((await response.text()).includes(content), `${pathname} must include ${content}`);
    console.log(`PASS ${pathname}`);
  }
  // No real signup or database write is needed to check the API boundary.
  const invalidSignup = await handler.fetch(
    new Request("https://farmjs.dev/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://farmjs.dev" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  assert.equal(invalidSignup.status, 400, "waitlist validation must remain available");
  console.log("PASS waitlist validation");
  process.exit(0);
}

const functionRoot = fileURLToPath(
  new URL("../.vercel/output/functions/__nitro.func/", import.meta.url),
);
const config = JSON.parse(await readFile(path.join(functionRoot, ".vc-config.json"), "utf8"));
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "farm-docs-vercel-check-"));
try {
  const isolatedFunction = path.join(isolatedRoot, "function");
  await cp(functionRoot, isolatedFunction, { recursive: true, dereference: true });
  execFileSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--function", path.join(isolatedFunction, config.handler)],
    {
      cwd: isolatedFunction,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_PATH: "",
        DATABASE_URL: "",
        WAITLIST_DATABASE_URL: "",
      },
      stdio: "inherit",
      timeout: 60_000,
    },
  );
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
