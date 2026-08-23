#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const examplesRoot = path.join(root, "examples");

// "stackblitz" installs published packages from npm instead of workspace:*,
// so it has no node_modules here and is built by StackBlitz itself.
const ignoredDirs = new Set(["node_modules", ".output", ".vercel", ".eve", "dist", "stackblitz"]);
const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const skipIncompatible = args.has("--skip-incompatible");
const onlyWithNodeEngine = args.has("--only-with-node-engine");
const currentNodeVersion = process.versions.node;
const currentNodeMajor = Number(currentNodeVersion.split(".")[0]);

const buildEnv = {
  ...process.env,
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:3000",
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID || "ci-auth0-client-id",
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET || "ci-auth0-client-secret",
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN || "ci.example.auth0.com",
  AUTH0_SECRET: process.env.AUTH0_SECRET || "ci-auth0-session-secret-at-least-32-characters",
  AUTUMN_SECRET_KEY: process.env.AUTUMN_SECRET_KEY || "am_sk_ci",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "ci-better-auth-secret",
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || "sk_test_ci",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "pk_test_ci",
  INNGEST_APP_ID: process.env.INNGEST_APP_ID || "farm-ci",
  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY || "ci-inngest-event-key",
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY || "ci-inngest-signing-key",
  POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN || "polar_ci",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "re_ci",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "Farm CI <ci@example.com>",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_ci",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "ci-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "ci-supabase-service-key",
  SUPABASE_URL: process.env.SUPABASE_URL || "https://ci.supabase.co",
  TRIGGER_PROJECT_REF: process.env.TRIGGER_PROJECT_REF || "proj_ci",
  TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY || "tr_ci",
  WORKOS_API_KEY: process.env.WORKOS_API_KEY || "sk_test_ci",
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID || "client_ci",
  WORKOS_COOKIE_PASSWORD:
    process.env.WORKOS_COOKIE_PASSWORD || "ci-cookie-password-at-least-32-characters",
};

function supportsCurrentNode(range) {
  if (!range) {
    return true;
  }

  const normalized = range.trim();
  if (normalized === "22.x") {
    return currentNodeMajor === 22;
  }

  const minMajorMatch = normalized.match(/^>=\s*(\d+)/);
  if (minMajorMatch) {
    return currentNodeMajor >= Number(minMajorMatch[1]);
  }

  return true;
}

function findExamplePackages(dir, packages = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findExamplePackages(entryPath, packages);
      continue;
    }

    if (entry.name !== "package.json") {
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    if (pkg.scripts?.build) {
      packages.push({
        dir: path.dirname(entryPath),
        nodeEngine: pkg.engines?.node,
      });
    }
  }

  return packages;
}

const examples = findExamplePackages(examplesRoot).sort((left, right) =>
  left.dir.localeCompare(right.dir),
);

let built = 0;
let skipped = 0;

for (const example of examples) {
  const relative = path.relative(root, example.dir);
  const isCompatible = supportsCurrentNode(example.nodeEngine);

  if (onlyWithNodeEngine && !example.nodeEngine) {
    skipped += 1;
    continue;
  }

  if (!isCompatible) {
    if (!skipIncompatible) {
      console.error(
        `\nExample ${relative} requires Node ${example.nodeEngine}, current Node is ${currentNodeVersion}.`,
      );
      process.exit(1);
    }

    skipped += 1;
    console.log(
      `\n> Skipping ${relative} (requires Node ${example.nodeEngine}, current Node is ${currentNodeVersion})`,
    );
    continue;
  }

  console.log(`\n> Building ${relative}`);

  const result = spawnSync("pnpm", ["--dir", example.dir, "build"], {
    cwd: root,
    env: buildEnv,
    shell: true,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\nExample build failed: ${relative}`);
    process.exit(result.status || 1);
  }

  built += 1;
}

console.log(`\nBuilt ${built} examples. Skipped ${skipped} examples.`);
