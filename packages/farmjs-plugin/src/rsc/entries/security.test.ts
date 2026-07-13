import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import type { EntryContext } from "../types.js";
import { generateClientEntry } from "./client.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: true,
  serverActions: {
    allowedOrigins: ["https://proxy.example.com"],
    bodySizeLimit: 500_000,
  },
  deploymentId: "release-2",
  debug: false,
};

describe("generated server action security", () => {
  it("validates and bounds requests before decoding or executing actions", () => {
    const entry = generateRscEntry(context);

    expect(entry).toContain("from '@farmjs/core/server-action-security'");
    expect(entry).toContain(
      'const serverActionSecurity = {"allowedOrigins":["https://proxy.example.com"],"bodySizeLimit":500000};',
    );
    expect(entry).toContain("await prepareServerActionRequest(");
    expect(entry.indexOf("validateServerActionRequest(request")).toBeLessThan(
      entry.indexOf("const middlewareResult = await executeMiddleware(request"),
    );
    expect(entry.indexOf("await prepareServerActionRequest(")).toBeLessThan(
      entry.indexOf("await decodeReply("),
    );
    expect(entry).toContain("await runWithServerActionRequest(request");
    expect(entry).toContain("sanitizeServerActionError(e)");
    expect(entry).toContain("headers.set('cache-control', 'no-store')");
    const outerCatch = entry.lastIndexOf("} catch (err) {");
    const sanitizedPostFailure = entry.indexOf(
      "return new Response('Server function failed'",
      outerCatch,
    );
    expect(outerCatch).toBeGreaterThan(-1);
    expect(sanitizedPostFailure).toBeGreaterThan(outerCatch);
    expect(entry.slice(outerCatch, sanitizedPostFailure)).toContain(
      "if (request.method === 'POST')",
    );
    expect(entry).not.toContain("returnValue = { ok: false, data: e }");
  });

  it("keeps browser action requests same-origin and turns failures into Errors", () => {
    const entry = generateClientEntry(context);

    expect(entry).toContain("credentials: 'same-origin'");
    expect(entry).toContain("redirect: 'error'");
    expect(entry).toContain("cache: 'no-store'");
    expect(entry).toContain("error.name = 'ServerActionError'");
    expect(entry).not.toContain("throw p.returnValue?.data");
  });

  it("rejects stale actions before decoding and only reloads safe navigation", () => {
    const serverEntry = generateRscEntry(context);
    const clientEntry = generateClientEntry(context);

    expect(serverEntry).toContain('const farmDeploymentId = "release-2"');
    expect(serverEntry).toContain("createFarmDeploymentCookie(");
    expect(serverEntry.indexOf("getFarmDeploymentMismatch(request")).toBeLessThan(
      serverEntry.indexOf("validateServerActionRequest(request"),
    );

    expect(clientEntry).toContain("createFarmDeploymentRequestHeaders(farmDeploymentId");
    expect(clientEntry).toContain("throw reportDeploymentMismatch(res)");
    expect(clientEntry).toContain("location.assign(url)");

    const actionStart = clientEntry.indexOf("setServerCallback(async");
    const actionEnd = clientEntry.indexOf("// Debug logging helper");
    const actionClient = clientEntry.slice(actionStart, actionEnd);
    expect(actionClient).not.toContain("location.assign(");
    expect(actionClient).not.toContain("location.reload(");
  });

  it("merges layer route roots before project routes", async () => {
    const entry = generateRscEntry({
      ...context,
      routeRoots: [
        {
          name: "admin-layer",
          base: "../../layers/admin/src/app",
          glob: "../../layers/admin/src/app",
        },
        {
          name: "project",
          base: "../../src/app",
          glob: "../../src/app",
        },
      ],
    });

    expect(entry).toContain(
      'import.meta.glob("../../layers/admin/src/app/**/page.{tsx,jsx,ts,js}"',
    );
    expect(entry).toContain('import.meta.glob("../../src/app/**/page.{tsx,jsx,ts,js}"');
    expect(entry.indexOf("modules: pages0")).toBeLessThan(entry.indexOf("modules: pages1"));
    expect(entry).toContain("merged[relative] = module");
    await expect(
      transformWithEsbuild(entry, "layered-entry.rsc.tsx", { loader: "tsx" }),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });

  it("emits syntactically valid RSC and browser entries", async () => {
    await expect(
      transformWithEsbuild(generateRscEntry(context), "entry.rsc.tsx", { loader: "tsx" }),
    ).resolves.toMatchObject({ code: expect.any(String) });
    await expect(
      transformWithEsbuild(generateClientEntry(context), "entry.browser.tsx", { loader: "tsx" }),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });
});
