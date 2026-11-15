import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineBotWidget,
  loadBotScript,
  mountBotCheck,
  provideBotWidget,
  startBotWidget,
  type BotWidgetDriver,
  type BotWidgetMount,
} from "./client";

let runtime: { close(): void } | undefined;

function providerScripts() {
  return [...document.querySelectorAll<HTMLScriptElement>("script[data-farm-bot-script]")];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "<form><div id='a'></div><div id='b'></div></form>";
  delete (window as any)[Symbol.for("farm.bot")];
});

afterEach(() => {
  runtime?.close();
  runtime = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mountBotCheck with a custom driver", () => {
  function driver() {
    const widget = { reset: vi.fn(), remove: vi.fn() };
    const mount = vi.fn((_element: HTMLElement, _mount: BotWidgetMount) => widget);
    return { widget, mount, driver: { mount } satisfies BotWidgetDriver };
  }

  it("gives the driver the element, callbacks, and defaults", async () => {
    const { driver: custom, mount } = driver();
    runtime = provideBotWidget(custom, window);
    const onVerify = vi.fn();
    const element = document.getElementById("a")!;
    mountBotCheck(element, { onVerify });
    await flush();

    const [mountedInto, options] = mount.mock.calls[0]!;
    expect(mountedInto).toBe(element);
    expect(options).toMatchObject({ theme: "auto", settings: {} });
    options.onVerify("token");
    expect(onVerify).toHaveBeenCalledWith("token");
  });

  it("removes a widget whose async mount finishes after the app removed it", async () => {
    const widget = { reset: vi.fn(), remove: vi.fn() };
    let finish!: (value: typeof widget) => void;
    let received: BotWidgetMount | undefined;
    runtime = provideBotWidget(
      {
        mount(_element, mount) {
          received = mount;
          return new Promise((resolve) => (finish = resolve));
        },
      },
      window,
    );
    const mounted = mountBotCheck(document.getElementById("a")!);
    await flush();
    mounted.remove();
    expect(received!.signal.aborted).toBe(true);

    finish(widget);
    await flush();
    expect(widget.remove).toHaveBeenCalledTimes(1);
  });

  it("ignores callbacks and errors that arrive after the app removed the widget", async () => {
    const { driver: custom, mount } = driver();
    runtime = provideBotWidget(custom, window);
    const onVerify = vi.fn();
    const onExpire = vi.fn();
    const onError = vi.fn();
    const mounted = mountBotCheck(document.getElementById("a")!, { onVerify, onExpire, onError });
    await flush();
    mounted.remove();

    const late = mount.mock.calls[0]![1];
    late.onVerify("token");
    late.onExpire();
    late.onError(new Error("late"));
    expect(onVerify).not.toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a driver that throws", async () => {
    runtime = provideBotWidget(
      {
        mount() {
          throw new Error("no widget for you");
        },
      },
      window,
    );
    const onError = vi.fn();
    mountBotCheck(document.getElementById("a")!, { onError });
    await flush();
    expect(onError.mock.calls[0]![0].message).toBe("no widget for you");
  });

  it("reads callbacks fresh on every event when given a function", async () => {
    const { driver: custom, mount } = driver();
    runtime = provideBotWidget(custom, window);
    let onVerify = vi.fn();
    const first = onVerify;
    mountBotCheck(document.getElementById("a")!, () => ({ onVerify }));
    await flush();

    onVerify = vi.fn();
    mount.mock.calls[0]![1].onVerify("token");
    expect(first).not.toHaveBeenCalled();
    expect(onVerify).toHaveBeenCalledWith("token");
  });

  it("logs errors when the app has no handler", async () => {
    const { driver: custom, mount } = driver();
    runtime = provideBotWidget(custom, window);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mountBotCheck(document.getElementById("a")!);
    await flush();
    mount.mock.calls[0]![1].onError(new Error("boom"));
    expect(logged).toHaveBeenCalledWith("[farm:bot]", expect.any(Error));
  });
});

describe("startBotWidget", () => {
  const form = () => {
    const host = document.createElement("form");
    document.body.append(host);
    return host;
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const fieldValue = (host: HTMLElement) =>
    host.querySelector<HTMLInputElement>('input[name="acme-token"]')?.value;

  function widgetWith(captured: { mount?: BotWidgetMount }) {
    return defineBotWidget(() => ({
      mount(_element, mount) {
        captured.mount = mount;
        return { reset() {}, remove() {} };
      },
    }));
  }

  it("says the plugin's build half is missing when the widget module wasn't pointed at the widget", async () => {
    const { default: placeholder } = await import("./provider-widget");
    await expect(startBotWidget(placeholder, { widget: "/w.ts" })).rejects.toMatchObject({
      name: "BotError",
      code: "missing_plugin",
      message: expect.stringMatching(/no widget for "\/w\.ts".*`configure`.*`rsc` mode/),
    });
    await expect(startBotWidget(undefined, { widget: "/w.ts" })).rejects.toThrow(
      '"/w.ts" must have `defineBotWidget(...)` as its default export.',
    );
  });

  it("gives the widget the provider's public data", async () => {
    const create = vi.fn(() => ({ mount: () => ({ reset() {}, remove() {} }) }));
    runtime = await startBotWidget(create, { widget: "/w.ts", config: { siteKey: "k" } });
    expect(create).toHaveBeenCalledWith({ siteKey: "k" });
  });

  it("puts the token in the form under the provider's field, and updates it", async () => {
    const captured: { mount?: BotWidgetMount } = {};
    runtime = await startBotWidget(widgetWith(captured), {
      widget: "/w.ts",
      tokenField: "acme-token",
    });
    const host = form();
    const onVerify = vi.fn();
    mountBotCheck(host, { onVerify });
    await tick();

    expect(fieldValue(host)).toBeUndefined();
    captured.mount!.onVerify("first");
    captured.mount!.onVerify("second");
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(fieldValue(host)).toBe("second");
    expect(new FormData(host as HTMLFormElement).get("acme-token")).toBe("second");
    expect(onVerify).toHaveBeenLastCalledWith("second");
  });

  it("takes the token out of the form on expiry, reset, and removal", async () => {
    const captured: { mount?: BotWidgetMount } = {};
    runtime = await startBotWidget(widgetWith(captured), {
      widget: "/w.ts",
      tokenField: "acme-token",
    });
    const host = form();
    const onExpire = vi.fn();
    const check = mountBotCheck(host, { onExpire });
    await tick();

    captured.mount!.onVerify("token");
    captured.mount!.onExpire();
    expect(fieldValue(host)).toBeUndefined();
    expect(onExpire).toHaveBeenCalledTimes(1);

    captured.mount!.onVerify("token");
    check.reset();
    expect(fieldValue(host)).toBeUndefined();

    captured.mount!.onVerify("token");
    check.remove();
    expect(host.querySelector("input")).toBeNull();
  });

  it("writes no token after the app removed the widget", async () => {
    const captured: { mount?: BotWidgetMount } = {};
    runtime = await startBotWidget(widgetWith(captured), {
      widget: "/w.ts",
      tokenField: "acme-token",
    });
    const host = form();
    const check = mountBotCheck(host);
    await tick();
    check.remove();

    captured.mount!.onVerify("late");
    expect(host.querySelector("input")).toBeNull();
  });

  it("adds the field again when a widget redraws its element", async () => {
    let element: HTMLElement | undefined;
    let current: BotWidgetMount | undefined;
    runtime = await startBotWidget(
      defineBotWidget(() => ({
        mount(target, mount) {
          element = target;
          current = mount;
          return { reset() {}, remove() {} };
        },
      })),
      { widget: "/w.ts", tokenField: "acme-token" },
    );
    const host = form();
    mountBotCheck(host);
    await tick();

    current!.onVerify("first");
    element!.textContent = "Solved";
    current!.onVerify("second");
    expect(fieldValue(host)).toBe("second");
  });

  it("leaves the field to a widget that adds its own", async () => {
    const captured: { mount?: BotWidgetMount } = {};
    runtime = await startBotWidget(
      defineBotWidget(() => ({
        mount(element, mount) {
          captured.mount = mount;
          const own = element.ownerDocument.createElement("textarea");
          own.name = "acme-token";
          element.append(own);
          return { reset() {}, remove() {} };
        },
      })),
      { widget: "/w.ts", tokenField: "acme-token" },
    );
    const host = form();
    const onVerify = vi.fn();
    mountBotCheck(host, { onVerify });
    await tick();

    captured.mount!.onVerify("vendor-token");
    expect(host.querySelectorAll('[name="acme-token"]')).toHaveLength(1);
    expect(onVerify).toHaveBeenCalledWith("vendor-token");
  });

  it("adds no field for a check that has no token", async () => {
    const captured: { mount?: BotWidgetMount } = {};
    runtime = await startBotWidget(widgetWith(captured), { widget: "/w.ts" });
    const host = form();
    mountBotCheck(host);
    await tick();

    captured.mount!.onVerify("anything");
    expect(host.querySelector("input")).toBeNull();
  });

  it("lets a page gate its form the same way when the check draws nothing", async () => {
    runtime = await startBotWidget(
      defineBotWidget(() => {}),
      { widget: "/w.ts" },
    );
    const onVerify = vi.fn();
    const check = mountBotCheck(form(), { onVerify });
    await tick();
    expect(onVerify).toHaveBeenCalledWith("");

    // A page turns its button off after each submit and waits to hear from the check again.
    check.reset();
    expect(onVerify).toHaveBeenCalledTimes(2);
  });

  it("names the module when its default export isn't a widget", async () => {
    await expect(startBotWidget(undefined, { widget: "/src/w.ts" })).rejects.toThrow(
      /"\/src\/w\.ts".*default export/,
    );
    await expect(startBotWidget(() => ({}), { widget: "/src/w.ts" })).rejects.toThrow(
      /"\/src\/w\.ts".*`mount`/,
    );
  });
});

describe("the missing plugin warning", () => {
  it("says what to add when no provider starts", () => {
    vi.useFakeTimers();
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountBotCheck(document.getElementById("a")!);
    vi.advanceTimersByTime(3000);
    expect(warned.mock.calls[0]![0]).toContain("bot({ provider })");
  });

  it("stays quiet when the widget is removed first or a provider arrives in time", async () => {
    vi.useFakeTimers();
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    mountBotCheck(document.getElementById("a")!).remove();

    mountBotCheck(document.getElementById("b")!);
    runtime = provideBotWidget({ mount: () => ({ reset() {}, remove() {} }) }, window);
    await vi.advanceTimersByTimeAsync(3000);

    expect(warned).not.toHaveBeenCalled();
  });
});

describe("loadBotScript", () => {
  it("is available to custom widgets and loads once", async () => {
    const first = loadBotScript("https://js.acme.example/a.js", { global: "acme" }, window);
    const second = loadBotScript("https://js.acme.example/a.js", { global: "acme" }, window);
    expect(providerScripts()).toHaveLength(1);

    (window as any).acme = { ok: true };
    providerScripts()[0]!.dispatchEvent(new Event("load"));
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    delete (window as any).acme;
  });

  it("rejects when the script doesn't define its global", async () => {
    const loading = loadBotScript("https://js.acme.example/b.js", { global: "acme" }, window);
    providerScripts()[0]!.dispatchEvent(new Event("load"));
    await expect(loading).rejects.toThrow(/without defining window.acme/);
  });
});
