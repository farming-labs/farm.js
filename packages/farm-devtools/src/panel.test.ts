// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPanel } from "./panel.js";

let panel: ReturnType<typeof startPanel> | undefined;
afterEach(() => {
  panel?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function openPlugins(plugins: unknown[]) {
  window.history.replaceState(null, "", "#plugins");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  window.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      project: { name: "app" },
      counts: {},
      routes: [],
      apiRoutes: [],
      diagnostics: [],
      plugins,
      generatedAt: new Date().toISOString(),
    }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  panel = startPanel(root);
  await vi.waitFor(() => expect(root.querySelector("h2")?.textContent).toBe("Plugins"));
  return root;
}

describe("Plugins view", () => {
  it("escapes names and metadata and groups declared hooks", async () => {
    const root = await openPlugins([
      {
        name: '<img src=x onerror="alert(1)">',
        version: "<script>bad()</script>",
        order: 1,
        enforce: "pre",
        routes: true,
        serverHooks: ["runtime.before"],
        clientHooks: ["client.navigation.rendered"],
      },
    ]);
    expect(root.querySelectorAll(".fd-plugin img, .fd-plugin script")).toHaveLength(0);
    expect(root.querySelector("summary")?.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(root.textContent).toContain("runtime.before");
    expect(root.textContent).toContain("client.navigation.rendered");
    expect(root.textContent).toContain("Declared");
  });
  it("explains an empty plugin manager", async () => {
    const root = await openPlugins([]);
    expect(root.textContent).toContain("No active Farm plugins");
    expect(root.querySelector('[data-count="plugins"]')?.textContent).toBe("0");
  });
});

describe("Live Inspect", () => {
  it("labels stale output, rejects unrelated messages, refreshes the selection, and disposes", async () => {
    await openPlugins([]);
    panel!.dispose();
    document.body.replaceChildren();
    const parent = {} as Window;
    vi.spyOn(window, "parent", "get").mockReturnValue(parent);
    window.history.replaceState(null, "", "#inspect");
    let source = "export const value = 1;";
    window.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/modules.json")
          ? {
              modules: [{ id: "chosen", path: "src/value.ts", url: "/src/value.ts" }],
              limited: false,
            }
          : url.includes("/module.json?")
            ? { id: "chosen", source, transformed: source, imports: [], importers: [] }
            : {
                project: { name: "app" },
                counts: {},
                routes: [],
                apiRoutes: [],
                diagnostics: [],
                plugins: [],
                generatedAt: new Date().toISOString(),
              },
    }));
    const root = document.createElement("div");
    root.dataset.inspect = "true";
    document.body.append(root);
    panel = startPanel(root);
    await vi.waitFor(() => expect(root.querySelector("pre")?.textContent).toContain("value = 1"));
    const send = (state: string, origin = window.location.origin, sender = parent) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin,
          source: sender,
          data: { type: "farm:devtools:hmr", state },
        }),
      );
    const calls = vi.mocked(window.fetch).mock.calls.length;
    send("pending", "https://untrusted.example");
    send("pending", window.location.origin, {} as Window);
    expect(root.textContent).not.toContain("HMR pending");
    send("pending");
    expect(root.querySelector("[data-module-state]")?.textContent).toContain("Showing previous");
    expect(root.querySelector("pre")?.textContent).toContain("value = 1");
    root.querySelector<HTMLButtonElement>("[data-refresh]")!.click();
    expect(window.fetch).toHaveBeenCalledTimes(calls);
    source = "export const value = 2;";
    send("ready");
    await vi.waitFor(() => expect(root.querySelector("pre")?.textContent).toContain("value = 2"));
    expect(root.querySelector("select")?.value).toBe("chosen");
    expect(root.textContent).not.toContain("Showing previous");
    send("error");
    expect(root.textContent).toContain("HMR failed");
    send("disconnected");
    expect(root.textContent).toContain("Disconnected");
    panel.dispose();
    const finalCalls = vi.mocked(window.fetch).mock.calls.length;
    send("ready");
    expect(window.fetch).toHaveBeenCalledTimes(finalCalls);
  });
});
