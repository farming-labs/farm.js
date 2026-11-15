import { describe, expect, it, vi } from "vitest";
import { generateClientEntry } from "./client.js";
import { generateRscEntry } from "./rsc.js";
import type { EntryContext } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "redirect-action-test",
  debug: false,
};

describe("server action redirect reaches the browser", () => {
  it("carries the redirect to the client instead of flattening it into an error", () => {
    const entry = generateRscEntry(context);

    // The action catch must recognise the redirect before the sanitizer runs,
    // and put it on returnValue so the client can act on it.
    expect(entry).toContain("const actionRedirect = getFarmRedirectError(e);");
    expect(entry).toContain(
      "returnValue = { ok: false, redirect: { url: actionRedirect.url, status: actionRedirect.status } };",
    );

    // Every other error still goes through the sanitizer.
    expect(entry).toContain("const actionError = sanitizeServerActionError(e);");
  });

  it("answers a no-JS form submission with a real redirect response", () => {
    const entry = generateRscEntry(context);

    const start = entry.indexOf("const formRedirect = getFarmRedirectError(e);");
    const end = entry.indexOf(
      "headers: { location: formRedirect.url, 'Cache-Control': 'no-store' },",
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // 303, so the browser follows it with a GET instead of posting the form again.
    expect(entry.slice(start, end)).toContain("status: 303,");
  });

  it("answers a no-JS form submission whose action calls notFound() with a 404", () => {
    const entry = generateRscEntry(context);

    const formCatch = entry.indexOf("const formRedirect = getFarmRedirectError(e);");
    const notFound = entry.indexOf("if (isFarmNotFoundError(e)) {", formCatch);
    const sanitized = entry.indexOf("const actionError = sanitizeServerActionError(e);", formCatch);
    expect(notFound).toBeGreaterThan(formCatch);
    // Recognised before the sanitizer, which would answer a 500 and log it as a crash.
    expect(notFound).toBeLessThan(sanitized);
    const handled = entry.slice(notFound, sanitized);
    expect(handled).toContain("return new Response('Not Found', {");
    expect(handled).toContain("status: 404,");
    expect(handled).toContain("'Cache-Control': 'no-store',");
  });

  it("navigates through the client router when the action redirected", async () => {
    const entry = generateClientEntry(context);
    const start = entry.indexOf("if (!p.returnValue || !p.returnValue.ok) {");
    const end = entry.indexOf("return completeFarmServerQueryAction", start);
    const source = entry.slice(start, end);

    const history = { pushState: vi.fn() };
    const navigate = vi.fn(async () => {});
    const farmNavigateRef = { current: navigate };
    const transportError = vi.fn(() => new Error("transport"));
    const run = new Function(
      "p",
      "history",
      "location",
      "farmNavigateRef",
      "createFarmServerFnTransportError",
      "debug",
      "id",
      `return (async () => { ${source} })();`,
    );

    // A redirected action navigates and does not throw.
    await expect(
      run(
        { returnValue: { ok: false, redirect: { url: "/dashboard", status: 303 } } },
        history,
        { href: "https://app.test/dashboard" },
        farmNavigateRef,
        transportError,
        () => {},
        "act",
      ),
    ).resolves.toBeUndefined();
    // navigate() offers it to navigation delegates, then writes history and renders.
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/dashboard", "push");
    expect(history.pushState).not.toHaveBeenCalled();
    expect(transportError).not.toHaveBeenCalled();

    // A genuine failure still throws, and does not navigate.
    history.pushState.mockClear();
    navigate.mockClear();
    await expect(
      run(
        { returnValue: { ok: false, data: { name: "ServerActionError" } } },
        history,
        { href: "https://app.test/dashboard" },
        farmNavigateRef,
        transportError,
        () => {},
        "act",
      ),
    ).rejects.toThrow("transport");
    expect(history.pushState).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("resolves every identifier the action callback uses at module scope", () => {
    // The previous version of this fix called refetch() directly, which is
    // declared inside main() and therefore unreachable from the action
    // callback: a ReferenceError only at runtime, in the browser. Evaluate the
    // module-scope portion of the entry for real so that class of mistake
    // fails here instead.
    const entry = generateClientEntry(context);
    const actionStart = entry.indexOf("setServerCallback(async (id, args) => {");
    const actionEnd = entry.indexOf("async function main()");
    const moduleScope = entry.slice(0, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    // Every free identifier the redirect branch relies on must be declared
    // before main(), not inside it.
    expect(moduleScope).toContain("const farmNavigateRef = { current: null };");
    expect(entry).toContain("farmNavigateRef.current = navigate;");
    expect(entry.slice(actionStart, actionEnd)).not.toContain("refetch(");
  });
});
