import { act, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideBotWidget, type BotCheckHandle, type BotWidgetMount } from "./client";
import { BotCheck } from "./react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
  const widget = { reset: vi.fn(), remove: vi.fn() };
  const mount = vi.fn((_element: HTMLElement, _mount: BotWidgetMount) => widget);
  const runtime = provideBotWidget({ mount }, window);
  const host = document.createElement("form");
  document.body.append(host);
  return { widget, mount, runtime, host, root: createRoot(host) };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any)[Symbol.for("farm.bot")];
});

describe("BotCheck for React", () => {
  it("mounts into its container, forwards callbacks, and removes on unmount", async () => {
    const { mount, widget, root, host, runtime } = setup();
    const onVerify = vi.fn();

    await act(async () => root.render(<BotCheck className="check" onVerify={onVerify} />));
    await settle();

    const container = host.querySelector("[data-farm-bot]")!;
    expect(container.className).toBe("check");
    expect(mount.mock.calls[0]![0]).toBe(container);
    mount.mock.calls[0]![1].onVerify("token-1");
    expect(onVerify).toHaveBeenCalledWith("token-1");

    await act(async () => root.unmount());
    expect(widget.remove).toHaveBeenCalledTimes(1);
    runtime.close();
  });

  it("exposes reset through a ref", async () => {
    const { widget, root, runtime } = setup();
    const ref = createRef<BotCheckHandle>();
    await act(async () => root.render(<BotCheck ref={ref} />));
    await settle();

    ref.current!.reset();
    expect(widget.reset).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    runtime.close();
  });

  it("uses the newest callback without remounting", async () => {
    const { mount, root, runtime } = setup();
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => root.render(<BotCheck onVerify={first} />));
    await settle();
    await act(async () => root.render(<BotCheck onVerify={second} />));
    await settle();

    expect(mount).toHaveBeenCalledTimes(1);
    mount.mock.calls[0]![1].onVerify("token");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("token");
    await act(async () => root.unmount());
    runtime.close();
  });

  it("remounts when the theme or settings change, but not for an equal settings object", async () => {
    const { mount, root, runtime } = setup();
    await act(async () => root.render(<BotCheck theme="light" settings={{ size: "compact" }} />));
    await settle();
    await act(async () => root.render(<BotCheck theme="light" settings={{ size: "compact" }} />));
    await settle();
    expect(mount).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<BotCheck theme="dark" settings={{ size: "compact" }} />));
    await settle();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1]![1].theme).toBe("dark");

    await act(async () => root.render(<BotCheck theme="dark" settings={{ size: "normal" }} />));
    await settle();
    expect(mount).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
    runtime.close();
  });

  it("tells the app its token is gone when a new appearance remounts the widget", async () => {
    const { root, runtime } = setup();
    const onExpire = vi.fn();
    await act(async () => root.render(<BotCheck theme="light" onExpire={onExpire} />));
    await settle();
    await act(async () => root.render(<BotCheck theme="light" onExpire={onExpire} />));
    await settle();
    expect(onExpire).not.toHaveBeenCalled();

    await act(async () => root.render(<BotCheck theme="dark" onExpire={onExpire} />));
    await settle();
    expect(onExpire).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    runtime.close();
  });

  it("mounts once under Strict Mode's double effects", async () => {
    const { mount, root, runtime } = setup();
    const strictExpire = vi.fn();
    await act(async () =>
      root.render(
        <StrictMode>
          <BotCheck onExpire={strictExpire} />
        </StrictMode>,
      ),
    );
    await settle();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(strictExpire).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    runtime.close();
  });
});
