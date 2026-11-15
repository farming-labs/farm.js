import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBotCheck, provideBotWidget, startBotWidget } from "../client";
import { createScriptWidget, type ScriptWidgetConfig } from "./widget";

const config: ScriptWidgetConfig = {
  name: "turnstile",
  siteKey: "site-key",
  scriptUrl: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  global: "turnstile",
  autoTheme: true,
};

const fakeApi = () => ({
  render: vi.fn((_element: HTMLElement, _options: Record<string, any>) => "widget-1"),
  reset: vi.fn(),
  remove: vi.fn(),
});

let runtime: { close(): void } | undefined;

function providerScripts() {
  return [...document.querySelectorAll<HTMLScriptElement>("script[data-farm-bot-script]")];
}

function loadScript(api: ReturnType<typeof fakeApi>) {
  (window as any).turnstile = api;
  providerScripts().at(-1)!.dispatchEvent(new Event("load"));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const start = (widget = config) => {
  runtime = provideBotWidget(createScriptWidget(widget), window);
  return runtime;
};

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "<form><div id='a'></div><div id='b'></div></form>";
  delete (window as any).turnstile;
  delete (window as any).grecaptcha;
  delete (window as any)[Symbol.for("farm.bot")];
});

afterEach(() => {
  runtime?.close();
  runtime = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mountBotCheck with a script widget", () => {
  it("waits for the provider, then loads the script once for every widget", async () => {
    const api = fakeApi();
    const onVerify = vi.fn();
    mountBotCheck(document.getElementById("a")!, { onVerify, theme: "dark" });
    mountBotCheck(document.getElementById("b")!);
    await flush();
    expect(providerScripts()).toHaveLength(0);

    start();
    await flush();
    expect(providerScripts()).toHaveLength(1);
    expect(providerScripts()[0]!.src).toBe(config.scriptUrl);

    loadScript(api);
    await flush();
    expect(api.render).toHaveBeenCalledTimes(2);
    const [host, options] = api.render.mock.calls[0]!;
    expect(host.parentElement?.id).toBe("a");
    expect(options).toMatchObject({ sitekey: "site-key", theme: "dark" });

    options.callback("token-1");
    expect(onVerify).toHaveBeenCalledWith("token-1");
  });

  it("does not render a widget removed before the script loaded", async () => {
    const api = fakeApi();
    start();
    const widget = mountBotCheck(document.getElementById("a")!);
    await flush();
    widget.remove();
    loadScript(api);
    await flush();
    expect(api.render).not.toHaveBeenCalled();
  });

  it("removes and resets a rendered widget through the provider", async () => {
    const api = fakeApi();
    start();
    const element = document.getElementById("a")!;
    const widget = mountBotCheck(element);
    await flush();
    loadScript(api);
    await flush();

    widget.reset();
    expect(api.reset).toHaveBeenCalledWith("widget-1");
    widget.remove();
    widget.remove();
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(element.children).toHaveLength(0);
  });

  it("reports a script that fails to load and lets the next widget retry", async () => {
    const onError = vi.fn();
    start();
    mountBotCheck(document.getElementById("a")!, { onError });
    await flush();
    providerScripts()[0]!.dispatchEvent(new Event("error"));
    await flush();
    expect(onError.mock.calls[0]![0].message).toMatch(/CSP allows it/);
    expect(providerScripts()).toHaveLength(0);

    mountBotCheck(document.getElementById("b")!);
    await flush();
    expect(providerScripts()).toHaveLength(1);
  });

  it("reports widget errors with the provider's code", async () => {
    const api = fakeApi();
    const onError = vi.fn();
    start();
    mountBotCheck(document.getElementById("a")!, { onError });
    await flush();
    loadScript(api);
    await flush();
    api.render.mock.calls[0]![1]["error-callback"]("600010");
    expect(onError.mock.calls[0]![0].message).toContain("600010");

    api.render.mock.calls[0]![1]["error-callback"]();
    expect(onError.mock.calls[1]![0].message).toBe("The turnstile widget failed.");
  });

  it("carries the page's CSP nonce to the provider script", async () => {
    const own = document.createElement("script");
    own.nonce = "abc123";
    document.head.append(own);
    start();
    mountBotCheck(document.getElementById("a")!);
    await flush();
    expect(providerScripts()[0]!.nonce).toBe("abc123");
  });

  it("reuses a provider script that is already on the page", async () => {
    const api = fakeApi();
    (window as any).turnstile = api;
    start();
    mountBotCheck(document.getElementById("a")!);
    await flush();
    expect(providerScripts()).toHaveLength(0);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("passes settings through but never lets them replace what Farm controls", async () => {
    const api = fakeApi();
    (window as any).turnstile = api;
    start();
    mountBotCheck(document.getElementById("a")!, {
      settings: { size: "compact", sitekey: "attacker", callback: "nope" },
    });
    await flush();
    const options = api.render.mock.calls[0]![1];
    expect(options.size).toBe("compact");
    expect(options.sitekey).toBe("site-key");
    expect(typeof options.callback).toBe("function");
  });

  it("passes auto through to providers that support it", async () => {
    const api = fakeApi();
    (window as any).turnstile = api;
    start();
    mountBotCheck(document.getElementById("a")!);
    await flush();
    expect(api.render.mock.calls[0]![1].theme).toBe("auto");
  });

  it("resolves auto from the color scheme for providers that don't", async () => {
    const api = fakeApi();
    (window as any).turnstile = api;
    (window as any).matchMedia = vi.fn(() => ({ matches: true }));
    start({ ...config, autoTheme: false });
    mountBotCheck(document.getElementById("a")!);
    await flush();
    expect(api.render.mock.calls[0]![1].theme).toBe("dark");
    delete (window as any).matchMedia;
  });

  it("works with a provider that has no remove, and can mount again in the same element", async () => {
    const hosts = new Set<HTMLElement>();
    const api = {
      reset: vi.fn(),
      render: vi.fn((host: HTMLElement, _options: Record<string, any>) => {
        if (hosts.has(host)) throw new Error("already rendered in this element");
        hosts.add(host);
        return 0;
      }),
    };
    (window as any).turnstile = api;
    start();
    const element = document.getElementById("a")!;

    const first = mountBotCheck(element);
    await flush();
    first.reset();
    expect(api.reset).toHaveBeenCalledWith(0);
    first.remove();
    expect(element.children).toHaveLength(0);

    mountBotCheck(element);
    await flush();
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(element.children).toHaveLength(1);
  });

  it("leaves nothing behind when the provider's render throws", async () => {
    const api = fakeApi();
    api.render.mockImplementation(() => {
      throw new Error("bad site key");
    });
    (window as any).turnstile = api;
    start();
    const onError = vi.fn();
    const element = document.getElementById("a")!;
    mountBotCheck(element, { onError });
    await flush();
    expect(onError.mock.calls[0]![0].message).toBe("bad site key");
    expect(element.children).toHaveLength(0);
  });

  it("waits for a ready callback when the script's load event comes too early", async () => {
    const api = fakeApi();
    start({ ...config, global: "grecaptcha", readyCallback: true });
    mountBotCheck(document.getElementById("a")!);
    await flush();

    const script = providerScripts()[0]!;
    const callback = new URL(script.src).searchParams.get("onload")!;
    expect(callback).toMatch(/^__farmBotReady/);

    (window as any).grecaptcha = { ready() {} };
    script.dispatchEvent(new Event("load"));
    await flush();
    expect(api.render).not.toHaveBeenCalled();

    (window as any).grecaptcha = api;
    (window as any)[callback]();
    await flush();
    expect(api.render).toHaveBeenCalledTimes(1);
    expect((window as any)[callback]).toBeUndefined();
  });

  it("forgets the provider when the plugin closes", async () => {
    start();
    runtime!.close();
    runtime = undefined;
    mountBotCheck(document.getElementById("a")!);
    await flush();
    expect(providerScripts()).toHaveLength(0);
  });
});

describe("startBotWidget with a script widget", () => {
  it("leaves the field to a script that adds its own, as vendor scripts do", async () => {
    const api = fakeApi();
    api.render.mockImplementation((element) => {
      const own = element.ownerDocument.createElement("textarea");
      own.name = "cf-turnstile-response";
      element.append(own);
      return "widget-1";
    });
    (window as any).turnstile = api;
    runtime = await startBotWidget(createScriptWidget, {
      widget: "@farm.js/bot/script-widget",
      tokenField: "cf-turnstile-response",
      config,
    });
    const host = document.querySelector<HTMLFormElement>("form")!;
    const onVerify = vi.fn();
    mountBotCheck(host, { onVerify });
    await flush();

    api.render.mock.calls[0]![1].callback("vendor-token");
    expect(host.querySelectorAll('[name="cf-turnstile-response"]')).toHaveLength(1);
    expect(onVerify).toHaveBeenCalledWith("vendor-token");
    delete (window as any).turnstile;
  });

  it("fills in the field for a script that doesn't add one", async () => {
    const api = fakeApi();
    (window as any).turnstile = api;
    runtime = await startBotWidget(createScriptWidget, {
      widget: "@farm.js/bot/script-widget",
      tokenField: "cf-turnstile-response",
      config,
    });
    const host = document.querySelector<HTMLFormElement>("form")!;
    mountBotCheck(host);
    await flush();

    api.render.mock.calls[0]![1].callback("vendor-token");
    expect(new FormData(host as HTMLFormElement).get("cf-turnstile-response")).toBe("vendor-token");
    delete (window as any).turnstile;
  });
});
