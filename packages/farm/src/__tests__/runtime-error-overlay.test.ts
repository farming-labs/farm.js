/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmRuntimeErrorOverlay } from "../client/runtime-error-overlay";

function createLocation(pathname = "/dashboard") {
  return {
    href: `http://localhost${pathname}`,
    pathname,
    search: "",
    hash: "",
  };
}

function getOverlay() {
  const host = document.querySelector<HTMLDivElement>("[data-farm-runtime-error-overlay]");
  const shadow = host?.shadowRoot;
  if (!host || !shadow) throw new Error("Expected the Farm runtime error overlay");
  return { host, shadow };
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("client runtime error overlay", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark", "light");
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the error and resolves a same-origin source frame", async () => {
    const source = [
      "export function mount() {",
      "  const user = undefined;",
      "  return user.name;",
      "}",
      "mount();",
    ].join("\n");
    const request = vi.fn(async () => new Response(source, { status: 200 }));
    const overlay = createFarmRuntimeErrorOverlay({ window, fetch: request });
    const error = new TypeError("Cannot read properties of undefined (reading 'name')");
    error.stack = [
      error.toString(),
      `    at mount (${window.location.origin}/src/dashboard.tsx:3:15)`,
    ].join("\n");

    overlay.show(error, {
      phase: "unhandled-rejection",
      location: createLocation(),
    });
    await flushAsyncWork();

    const { host, shadow } = getOverlay();
    expect(host.hidden).toBe(false);
    expect(shadow.querySelector("[data-farm-runtime-error-message]")?.textContent).toBe(
      "Cannot read properties of undefined (reading 'name')",
    );
    expect(shadow.querySelector("[data-farm-runtime-error-phase]")?.textContent).toBe(
      "Unhandled Rejection",
    );
    expect(shadow.querySelector(".farm-default-error__source-path")?.textContent).toBe(
      "/src/dashboard.tsx:3:15",
    );
    expect(shadow.querySelector(".farm-default-error__source-line--active")?.textContent).toContain(
      "return user.name;",
    );
    const issueBody = new URL(
      shadow.querySelector<HTMLAnchorElement>("[data-farm-runtime-error-issue]")?.href || "",
    ).searchParams.get("body");
    expect(issueBody).toContain("return user.name;");
    expect(request).toHaveBeenCalledWith(
      `${window.location.origin}/src/dashboard.tsx`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    overlay.destroy();
  });

  it("deduplicates repeated failures and does not reopen a dismissed error", () => {
    const overlay = createFarmRuntimeErrorOverlay({ window });
    const error = new Error("Render loop failed");
    const context = { phase: "window", location: createLocation("/editor") };

    overlay.show(error, context);
    overlay.show(error, context);

    let current = getOverlay();
    expect(current.shadow.querySelector("[data-farm-runtime-error-occurrences]")?.textContent).toBe(
      "Repeated ×2",
    );
    expect(document.querySelectorAll("[data-farm-runtime-error-overlay]")).toHaveLength(1);

    current.shadow.querySelector<HTMLButtonElement>("[data-farm-runtime-error-dismiss]")?.click();
    expect(current.host.hidden).toBe(true);

    overlay.show(error, context);
    expect(current.host.hidden).toBe(true);

    overlay.show(new Error("A different failure"), context);
    current = getOverlay();
    expect(current.host.hidden).toBe(false);
    expect(current.shadow.querySelector("[data-farm-runtime-error-message]")?.textContent).toBe(
      "A different failure",
    );

    overlay.destroy();
  });

  it("copies an AI-friendly debug report and exposes issue and recovery actions", async () => {
    const reload = vi.fn();
    let copiedReport = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        copiedReport = document.querySelector<HTMLTextAreaElement>("textarea")?.value || "";
        return true;
      }),
    });
    const overlay = createFarmRuntimeErrorOverlay({
      window,
      farmVersion: "test-version",
      reload,
    });
    overlay.show(new Error("Widget crashed"), {
      phase: "hydration",
      location: createLocation("/widgets"),
    });

    const { shadow } = getOverlay();
    shadow.querySelector<HTMLButtonElement>("[data-farm-runtime-error-copy]")?.click();
    await flushAsyncWork();

    expect(copiedReport).toContain("# Farm.js client runtime debug report");
    expect(copiedReport).toContain("- Message: Widget crashed");
    expect(copiedReport).toContain("- Phase: Hydration");
    expect(copiedReport).toContain("- Farm.js: test-version");
    expect(copiedReport).toContain("## Diagnostic request");
    expect(shadow.querySelector("[data-farm-runtime-error-copy-label]")?.textContent).toBe(
      "Copied",
    );

    const issueLink = shadow.querySelector<HTMLAnchorElement>("[data-farm-runtime-error-issue]");
    const issueUrl = new URL(issueLink?.href || "");
    expect(issueUrl.origin + issueUrl.pathname).toBe(
      "https://github.com/farming-labs/farm.js/issues/new",
    );
    expect(issueUrl.searchParams.get("title")).toBe("[runtime error] Widget crashed");
    expect(issueUrl.searchParams.get("body")).toContain("## Runtime error report");
    expect(issueUrl.searchParams.get("body")).toContain("- Page path: /widgets");
    expect(issueUrl.searchParams.get("body")).not.toContain("http://localhost/widgets");
    expect(issueLink?.target).toBe("_blank");
    expect(issueLink?.rel).toBe("noopener noreferrer");

    shadow.querySelector<HTMLButtonElement>("[data-farm-runtime-error-reload]")?.click();
    expect(reload).toHaveBeenCalledOnce();

    overlay.destroy();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("follows an explicit dark theme and supports keyboard dismissal", async () => {
    const overlay = createFarmRuntimeErrorOverlay({ window });
    overlay.show(new Error("Theme test"), {
      phase: "window",
      location: createLocation(),
    });
    document.documentElement.dataset.theme = "dark";
    await flushAsyncWork();

    const { host, shadow } = getOverlay();
    expect(
      shadow.querySelector<HTMLElement>("[data-farm-runtime-error-viewport]")?.dataset.theme,
    ).toBe("dark");

    shadow.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.hidden).toBe(true);

    overlay.destroy();
  });

  it("leaves chunk-load failures to the existing recovery system", () => {
    const overlay = createFarmRuntimeErrorOverlay({ window });

    overlay.show(new TypeError("Failed to fetch dynamically imported module: /chunk.js"), {
      phase: "unhandled-rejection",
      location: createLocation(),
    });

    expect(document.querySelector("[data-farm-runtime-error-overlay]")).toBeNull();
    overlay.destroy();
  });
});
