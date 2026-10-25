// @vitest-environment node

import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";
import { workos } from "../../../farm-workos/src/index";
import { dispatchIntegrationRequest } from "../integrations";
import { loadFarmConfigFile } from "../layers";

// Auth0 and WorkOS used to fall back to constants published in their packages,
// so anyone who reached a dev server (a `farm preview` URL, `--host`) could sign
// or seal a session cookie for any user. Development now generates a random
// secret per app under `.farm`, resolved against the app root Farm is loading.
const OLD_AUTH0_SECRET = "farmjs-auth0-development-secret-2026";
const OLD_WORKOS_PASSWORD = "farmjs-workos-cookie-password-development-2026";
const FARM_CONFIG_ROOT = Symbol.for("farm.configRoot");
const ENV_KEYS = [
  "NODE_ENV",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "FARM_WORKOS_COOKIE_PASSWORD",
] as const;

type RootState = typeof globalThis & { [FARM_CONFIG_ROOT]?: string };
let savedEnv: Record<string, string | undefined>;
let root: string;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.AUTH0_DOMAIN = "tenant.us.auth0.com";
  process.env.AUTH0_CLIENT_ID = "client_test";
  process.env.WORKOS_CLIENT_ID = "client_test";
  process.env.WORKOS_API_KEY = "sk_test";
  root = mkdtempSync(path.join(os.tmpdir(), "farm-dev-secret-"));
});

afterEach(() => {
  delete (globalThis as RootState)[FARM_CONFIG_ROOT];
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(root, { recursive: true, force: true });
});

/** What `loadFarmConfigFile` sets while the app's farm.config evaluates. */
function evaluateConfigIn<T>(appRoot: string, evaluate: () => T): T {
  (globalThis as RootState)[FARM_CONFIG_ROOT] = appRoot;
  try {
    return evaluate();
  } finally {
    delete (globalThis as RootState)[FARM_CONFIG_ROOT];
  }
}

async function auth0StateCookie(integration: ReturnType<typeof auth0>): Promise<string> {
  const response = await dispatchIntegrationRequest(
    { integration, config: {}, isDev: true, isProd: false },
    new Request("http://localhost:3000/auth/login"),
  );
  const header = response!.headers
    .getSetCookie()
    .find((value) => value.startsWith("farm_auth0_state="));
  return header!.slice("farm_auth0_state=".length).split(";")[0]!;
}

function signedWith(cookie: string, secret: string): boolean {
  const separator = cookie.lastIndexOf(".");
  const payload = cookie.slice(0, separator);
  const expected = createHmac("sha256", secret).update(`farm-auth0:state.${payload}`).digest("hex");
  return cookie.slice(separator + 1) === expected;
}

describe("integration development secrets", () => {
  it("signs Auth0 cookies with a random secret persisted in the app root, not the cwd", async () => {
    process.env.NODE_ENV = "development";
    const integration = evaluateConfigIn(root, () => auth0());
    const file = path.join(root, ".farm", "auth0-secret");

    const secret = readFileSync(file, "utf8").trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const cwdFile = path.join(process.cwd(), ".farm", "auth0-secret");
    expect(existsSync(cwdFile) && readFileSync(cwdFile, "utf8").trim() === secret).toBe(false);

    const cookie = await auth0StateCookie(integration);
    expect(signedWith(cookie, secret)).toBe(true);
    expect(signedWith(cookie, OLD_AUTH0_SECRET)).toBe(false);

    // A restart reads the same secret back, so existing sessions stay valid.
    const restarted = evaluateConfigIn(root, () => auth0());
    expect(signedWith(await auth0StateCookie(restarted), secret)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(secret);
  });

  it("persists a random WorkOS cookie password per app", () => {
    process.env.NODE_ENV = "development";
    evaluateConfigIn(root, () => workos());
    const file = path.join(root, ".farm", "workos-secret");
    const password = readFileSync(file, "utf8").trim();

    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(password).not.toBe(OLD_WORKOS_PASSWORD);
    evaluateConfigIn(root, () => workos());
    expect(readFileSync(file, "utf8").trim()).toBe(password);
  });

  it("replaces a persisted value too short to be a secret", async () => {
    process.env.NODE_ENV = "development";
    const file = path.join(root, ".farm", "auth0-secret");
    evaluateConfigIn(root, () => auth0());
    writeFileSync(file, "short\n");

    const integration = evaluateConfigIn(root, () => auth0());
    const secret = readFileSync(file, "utf8").trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(signedWith(await auth0StateCookie(integration), secret)).toBe(true);
  });

  it("keeps test runs in memory and writes nothing", async () => {
    process.env.NODE_ENV = "test";
    const integration = evaluateConfigIn(root, () => auth0());

    expect(existsSync(path.join(root, ".farm"))).toBe(false);
    expect(signedWith(await auth0StateCookie(integration), OLD_AUTH0_SECRET)).toBe(false);
  });

  it("exposes the app root to integrations while farm.config evaluates", async () => {
    writeFileSync(
      path.join(root, "farm.config.mjs"),
      'export default { seenRoot: globalThis[Symbol.for("farm.configRoot")] };\n',
    );
    const config = await loadFarmConfigFile<{ seenRoot?: string }>(
      path.join(root, "farm.config.mjs"),
      { root },
    );

    expect(config.seenRoot).toBe(path.resolve(root));
    expect((globalThis as RootState)[FARM_CONFIG_ROOT]).toBeUndefined();
  });
});
