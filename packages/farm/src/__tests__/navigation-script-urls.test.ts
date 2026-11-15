// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFarmBlockedNavigationURL, isFarmExternalNavigationURL } from "../client/navigation-url";
import { SPARouter } from "../client/spa-router";
import { createRendererRouter } from "../renderer-client";

// Every one of these parses as a script-capable URL in a browser, so handing
// it to location.assign/replace/href would run it on the app's origin.
const SCRIPT_HREFS = [
  "javascript:alert(document.domain)",
  " JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "\u0001javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "blob:https://app.example.test/0d6c",
];

const PAGE = "https://app.example.test/login?next=x";

function fakeWindow() {
  return {
    location: {
      href: PAGE,
      origin: "https://app.example.test",
      pathname: "/login",
      search: "?next=x",
      hash: "",
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
    history: { state: null, length: 1, pushState: vi.fn(), replaceState: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollTo: vi.fn(),
  };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
  vi.unstubAllGlobals();
});

describe("isFarmBlockedNavigationURL", () => {
  it("blocks script-capable schemes after browser URL parsing", () => {
    for (const href of SCRIPT_HREFS) {
      expect(isFarmBlockedNavigationURL(new URL(href, PAGE)), JSON.stringify(href)).toBe(true);
    }
    expect(errors).toHaveBeenCalledWith(
      "[Farm.js] Blocked navigation to a javascript: URL as a security precaution.",
    );
  });

  it("allows relative, hash, same-origin, external http(s), mailto and tel targets", () => {
    for (const href of [
      "/dashboard",
      "details",
      "?tab=2",
      "#top",
      "//cdn.example.test/x",
      "https://other.example.test/x",
      "http://other.example.test/x",
      "mailto:team@example.test",
      "tel:+15550100",
    ]) {
      expect(isFarmBlockedNavigationURL(new URL(href, PAGE)), href).toBe(false);
    }
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("core SPARouter (dev path and client routers)", () => {
  function setup() {
    const window = fakeWindow();
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", { title: "" });
    const fetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetch);
    return {
      window,
      fetch,
      router: new SPARouter({ scrollRestoration: false, deploymentId: "test" }),
    };
  }

  it.each(SCRIPT_HREFS)("never hands %j to the browser", async (href) => {
    const { window, fetch, router } = setup();
    await router.navigate(href);
    await router.navigate(href, { replace: true });
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.href).toBe(PAGE);
    expect(fetch).not.toHaveBeenCalled();
    router.destroy();
  });

  it("keeps external http(s) and mailto document navigation", async () => {
    const { window, router } = setup();
    await router.navigate("https://other.example.test/x");
    await router.navigate("mailto:team@example.test", { replace: true });
    expect(window.location.assign).toHaveBeenCalledWith("https://other.example.test/x");
    expect(window.location.replace).toHaveBeenCalledWith("mailto:team@example.test");
    router.destroy();
  });

  it("still falls back to a document load when a same-origin navigation fails", async () => {
    const { window, router } = setup();
    await router.navigate("/dashboard");
    expect(window.location.href).toBe("/dashboard");
    router.destroy();
  });
});

describe("renderer router bindings (Vue, Solid, Svelte, Preact)", () => {
  it("push and replace refuse script URLs, so ?next= values cannot run", async () => {
    const window = fakeWindow();
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", { title: "", querySelector: () => null });
    vi.stubGlobal("fetch", vi.fn());
    const router = createRendererRouter();
    for (const href of SCRIPT_HREFS) {
      await router.push(href);
      await router.replace(href);
    }
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.href).toBe(PAGE);
  });
});

const universalSource = readFileSync(
  new URL("../nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const productionNavigations = [
  ...universalSource.matchAll(/ {2}navigate: async function\([^]*?\n {2}},/g),
].map(([method]) => method);

describe("generated production routers", () => {
  it("import the shared guard in both client runtimes", () => {
    expect(productionNavigations).toHaveLength(2);
    expect(
      universalSource.match(
        /import \{[^}]*\bisFarmBlockedNavigationURL\b[^}]*\} from "@farm\.js\/core\/internal\/client-runtime"/g,
      ),
    ).toHaveLength(2);
  });

  for (const [index, renderer] of ["html", "react"].entries()) {
    it(`${renderer} runtime never hands a script URL to the browser`, async () => {
      const window = fakeWindow();
      const router = new Function(
        "window",
        "isFarmBlockedNavigationURL",
        "isFarmExternalNavigationURL",
        `
          const isFarmDocsPath = () => false;
          return ({
            cancelActiveNavigation() {},
            ${productionNavigations[index]}
          });
        `,
      )(window, isFarmBlockedNavigationURL, isFarmExternalNavigationURL);

      for (const href of SCRIPT_HREFS) {
        await router.navigate(href);
        await router.navigate(href, { replace: true });
      }
      expect(window.location.href).toBe(PAGE);
      expect(window.location.assign).not.toHaveBeenCalled();
      expect(window.location.replace).not.toHaveBeenCalled();

      await router.navigate("https://other.example.test/x");
      expect(window.location.href).toBe("https://other.example.test/x");
    });
  }
});

describe("generated dev client", () => {
  const viteSource = readFileSync(new URL("../vite.ts", import.meta.url), "utf8");

  it("routes navigation through the guarded core SPARouter", () => {
    expect(viteSource).toContain(
      "import { installChunkErrorRecovery, SPARouter } from '@farm.js/core/client'",
    );
    expect(viteSource).toContain("const spaRouter = new SPARouter({");
  });

  it("guards the manifest router before any document navigation", async () => {
    const method = viteSource.match(
      / {2}async navigate\(href, options = \{\}\) \{[^]*?\n {2}}\n/,
    )?.[0];
    expect(method).toBeDefined();
    const window = fakeWindow();
    const router = new Function(
      "window",
      "isFarmBlockedNavigationURL",
      `
        const matchesDocumentNavigation = () => false;
        const findRoute = () => null;
        return ({ saveScrollPosition() {}, ${method} });
      `,
    )(window, isFarmBlockedNavigationURL);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const href of SCRIPT_HREFS) await router.navigate(href);
    expect(window.location.href).toBe(PAGE);
    expect(window.location.assign).not.toHaveBeenCalled();

    await router.navigate("/missing");
    expect(window.location.href).toBe("/missing");
  });
});
