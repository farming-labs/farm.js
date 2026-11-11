import { h as preactH, render as renderPreact, createRef as createPreactRef } from "preact";
import { act as preactAct } from "preact/test-utils";
import { createComponent, createSignal } from "solid-js";
import { render as renderSolid } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h as vueH, nextTick, ref as vueRef } from "vue";
import { provideBotWidget, type BotCheckHandle, type BotWidgetMount } from "./client";
import { BotCheck as PreactBotCheck } from "./preact";
import { BotCheck as SolidBotCheck } from "./solid";
import { botCheck } from "./svelte";
import { BotCheck as VueBotCheck } from "./vue";

function setup() {
  const widget = { reset: vi.fn(), remove: vi.fn() };
  const mount = vi.fn((_element: HTMLElement, _mount: BotWidgetMount) => widget);
  const runtime = provideBotWidget({ mount }, window);
  const host = document.createElement("form");
  document.body.append(host);
  return { widget, mount, runtime, host };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any)[Symbol.for("farm.bot")];
});

describe("BotCheck for Preact", () => {
  it("mounts, forwards callbacks, resets through a ref, and removes on unmount", async () => {
    const { mount, widget, host, runtime } = setup();
    const onVerify = vi.fn();
    const ref = createPreactRef<BotCheckHandle>();

    await preactAct(() => {
      renderPreact(preactH(PreactBotCheck, { ref, className: "check", onVerify }), host);
    });
    await flush();

    const container = host.querySelector("[data-farm-bot]")!;
    expect(container.className).toBe("check");
    expect(mount.mock.calls[0]![0]).toBe(container);
    mount.mock.calls[0]![1].onVerify("token");
    expect(onVerify).toHaveBeenCalledWith("token");

    ref.current!.reset();
    expect(widget.reset).toHaveBeenCalledTimes(1);

    await preactAct(() => {
      renderPreact(null, host);
    });
    expect(widget.remove).toHaveBeenCalledTimes(1);
    runtime.close();
  });
});

describe("BotCheck for Vue", () => {
  it("mounts, takes listeners, resets through a template ref, and removes on unmount", async () => {
    const { mount, widget, host, runtime } = setup();
    const onVerify = vi.fn();
    const handle = vueRef<BotCheckHandle>();

    const app = createApp({
      render: () => vueH(VueBotCheck, { ref: handle, class: "check", onVerify }),
    });
    app.mount(host);
    await nextTick();
    await flush();

    const container = host.querySelector<HTMLElement>("[data-farm-bot]")!;
    expect(container.className).toBe("check");
    expect(mount.mock.calls[0]![0]).toBe(container);
    mount.mock.calls[0]![1].onVerify("token");
    expect(onVerify).toHaveBeenCalledWith("token");

    handle.value!.reset();
    expect(widget.reset).toHaveBeenCalledTimes(1);

    app.unmount();
    expect(widget.remove).toHaveBeenCalledTimes(1);
    runtime.close();
  });

  it("remounts when the theme changes", async () => {
    const { mount, host, runtime } = setup();
    const theme = vueRef<"light" | "dark">("light");
    const app = createApp({ render: () => vueH(VueBotCheck, { theme: theme.value }) });
    app.mount(host);
    await nextTick();
    await flush();

    theme.value = "dark";
    await nextTick();
    await flush();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1]![1].theme).toBe("dark");
    app.unmount();
    runtime.close();
  });
});

describe("BotCheck for Vue, when the parent re-renders", () => {
  it("keeps the widget for an equal inline settings object", async () => {
    const { mount, host, runtime } = setup();
    const tick = vueRef(0);
    const onExpire = vi.fn();
    const app = createApp({
      render: () => {
        void tick.value;
        return vueH(VueBotCheck, { settings: { size: "compact" }, onExpire });
      },
    });
    app.mount(host);
    await nextTick();
    await flush();

    tick.value += 1;
    await nextTick();
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    app.unmount();
    runtime.close();
  });
});

describe("BotCheck for Solid", () => {
  it("mounts, forwards callbacks, resets through a ref, and removes on cleanup", async () => {
    const { mount, widget, host, runtime } = setup();
    const onVerify = vi.fn();
    let handle: BotCheckHandle | undefined;

    const dispose = renderSolid(
      () =>
        createComponent(SolidBotCheck, {
          class: "check",
          onVerify,
          ref: (value: BotCheckHandle) => (handle = value),
        }),
      host,
    );
    await flush();

    const container = host.querySelector<HTMLElement>("[data-farm-bot]")!;
    expect(container.className).toBe("check");
    expect(mount.mock.calls[0]![0]).toBe(container);
    mount.mock.calls[0]![1].onVerify("token");
    expect(onVerify).toHaveBeenCalledWith("token");

    handle!.reset();
    expect(widget.reset).toHaveBeenCalledTimes(1);

    dispose();
    expect(widget.remove).toHaveBeenCalledTimes(1);
    runtime.close();
  });

  it("remounts when the theme changes", async () => {
    const { mount, host, runtime } = setup();
    const [theme, setTheme] = createSignal<"light" | "dark">("light");
    const dispose = renderSolid(
      () =>
        createComponent(SolidBotCheck, {
          get theme() {
            return theme();
          },
        }),
      host,
    );
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);

    setTheme("dark");
    await flush();
    expect(mount).toHaveBeenCalledTimes(2);
    dispose();
    runtime.close();
  });
});

describe("BotCheck for Solid, when a signal changes", () => {
  it("keeps the widget for equal settings, and reports the lost token for new ones", async () => {
    const { mount, host, runtime } = setup();
    const [size, setSize] = createSignal("compact");
    const [tick, setTick] = createSignal(0);
    const onExpire = vi.fn();
    const dispose = renderSolid(
      () =>
        createComponent(SolidBotCheck, {
          onExpire,
          get settings() {
            void tick();
            return { size: size() };
          },
        }),
      host,
    );
    await flush();

    setTick(1);
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();

    setSize("normal");
    await flush();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(onExpire).toHaveBeenCalledTimes(1);
    dispose();
    runtime.close();
  });
});

describe("botCheck for Svelte", () => {
  it("mounts, forwards callbacks, resets through a ref, and removes on destroy", async () => {
    const { mount, widget, host, runtime } = setup();
    const onVerify = vi.fn();
    let handle: BotCheckHandle | undefined;

    const action = botCheck(host, { onVerify, ref: (value) => (handle = value) });
    await flush();

    expect(mount.mock.calls[0]![0]).toBe(host);
    mount.mock.calls[0]![1].onVerify("token");
    expect(onVerify).toHaveBeenCalledWith("token");

    handle!.reset();
    expect(widget.reset).toHaveBeenCalledTimes(1);

    action.destroy();
    expect(widget.remove).toHaveBeenCalledTimes(1);
    runtime.close();
  });

  it("swaps callbacks without remounting, and remounts for a new theme", async () => {
    const { mount, host, runtime } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const action = botCheck(host, { theme: "light", onVerify: first });
    await flush();

    action.update({ theme: "light", onVerify: second });
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    mount.mock.calls[0]![1].onVerify("token");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("token");

    action.update({ theme: "dark", onVerify: second });
    await flush();
    expect(mount).toHaveBeenCalledTimes(2);
    action.destroy();
    runtime.close();
  });
});
