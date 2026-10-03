// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

// Use a real Node process: production's deliberately external runtime import
// cannot execute inside Vitest's VM. Construct clients without connecting.
function checkClients(source: string, env: Record<string, string>) {
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';
       import { getPrisma, getWaitlistPrisma } from ${JSON.stringify(new URL("./prisma.ts", import.meta.url).href)};
       try { ${source} } finally {
         await globalThis.farmDocsPrisma?.$disconnect();
         await globalThis.farmDocsWaitlistPrisma?.$disconnect();
       }`,
    ],
    { env: { ...process.env, DATABASE_URL: "", WAITLIST_DATABASE_URL: "", ...env } },
  );
}

describe("waitlist database selection", () => {
  it("retains the shared database fallback for existing deployments", () => {
    checkClients("assert.equal(await getWaitlistPrisma(), await getPrisma());", {
      DATABASE_URL: "postgresql://test:password@localhost:5432/docs",
    });
  });

  it("caches a separate client without replacing the telemetry database client", () => {
    checkClients(
      `const telemetry = await getPrisma();
       const waitlist = await getWaitlistPrisma();
       assert.notEqual(waitlist, telemetry);
       assert.equal(await getWaitlistPrisma(), waitlist);
       assert.equal(await getPrisma(), telemetry);`,
      {
        DATABASE_URL: "postgresql://test:password@localhost:5432/docs",
        WAITLIST_DATABASE_URL: "postgresql://test:password@localhost:5432/waitlist",
      },
    );
  });

  it("works with only the waitlist database configured", () => {
    checkClients(
      `assert.ok(await getWaitlistPrisma());
       await assert.rejects(getPrisma(), /DATABASE_URL is not configured/);`,
      { WAITLIST_DATABASE_URL: "postgresql://test:password@localhost:5432/waitlist" },
    );
  });

  it("fails clearly when neither database is configured", () => {
    checkClients(
      "await assert.rejects(getWaitlistPrisma(), /DATABASE_URL is not configured/);",
      {},
    );
  });
});
