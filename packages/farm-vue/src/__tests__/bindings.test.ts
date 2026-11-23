// @vitest-environment jsdom

import { createApp, defineComponent, effectScope, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";
import { createStore } from "@farm.js/core/renderer-client";
import { useAction, useServerQuery, useStore } from "../bindings";

describe("Vue FARMJS bindings", () => {
  it("exposes action state through refs", async () => {
    const scope = effectScope();
    const action = scope.run(() => {
      const save = (async ({ name }: { name: string }) => ({ name })) as ServerFn<
        { name: string },
        { name: string }
      >;
      return useAction(save);
    })!;

    const pending = action({ name: "Vue" });
    expect(action.pending.value).toBe(true);
    await pending;
    expect(action.status.value).toBe("success");
    expect(action.data.value).toEqual({ name: "Vue" });
    scope.stop();
  });

  it("keeps zero-argument actions callable", async () => {
    const scope = effectScope();
    const action = scope.run(() => useAction((async () => "pong") as ServerFn<unknown, string>))!;

    await expect(action()).resolves.toBe("pong");
    scope.stop();
  });

  it("loads server queries in the browser", async () => {
    const query = (async () => ({ email: "vue@example.com" })) as ServerQuery<
      void,
      { email: string }
    >;
    const scope = effectScope();
    const account = scope.run(() => useServerQuery(query, undefined))!;

    await vi.waitFor(() => expect(account.data.value).toEqual({ email: "vue@example.com" }));
    expect(account.status.value).toBe("success");
    scope.stop();
  });

  it("binds a Farm store and stops listening with its scope", () => {
    const cart = createStore({ items: [] as string[] });
    const scope = effectScope();
    const state = scope.run(() => useStore(cart))!;

    cart.items.set(["tea"]);
    expect(state.value).toEqual({ items: ["tea"] });

    scope.stop();
    cart.items.set(["tea", "milk"]);
    expect(state.value).toEqual({ items: ["tea"] });
  });

  it("submits a Form's fields through the action and resets the form", async () => {
    const save = vi.fn(async (_data: FormData) => "saved") as unknown as ServerFn<FormData, string>;
    const onSubmit = vi.fn();
    let action!: ReturnType<typeof useAction<FormData, string>>;
    const { container, unmount } = mount(() => {
      action = useAction(save);
      return () =>
        h(action.Form, { id: "crop-form", class: "crop", onSubmit }, () => [
          h("input", { name: "name" }),
          h("button", { type: "submit", name: "intent", value: "publish" }, "Publish"),
        ]);
    });

    const form = container.querySelector("form")!;
    expect(form.id).toBe("crop-form");
    expect(form.className).toBe("crop");
    expect(form.getAttribute("method")).toBe("post");
    form.querySelector("input")!.value = "wheat";

    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(action.status.value).toBe("success"));

    const data = vi.mocked(save).mock.calls[0]![0];
    expect(data.get("name")).toBe("wheat");
    expect(data.get("intent")).toBe("publish");
    expect(form.querySelector("input")!.value).toBe("");
    unmount();
  });

  it("skips the action when the app's submit listener cancels the submission", async () => {
    const save = vi.fn(async () => "saved") as unknown as ServerFn<FormData, string>;
    const { container, unmount } = mount(() => {
      const action = useAction(save);
      return () =>
        h(action.Form, { onSubmit: (event: Event) => event.preventDefault() }, () => [
          h("input", { name: "name" }),
        ]);
    });

    submit(container.querySelector("form")!);
    await Promise.resolve();

    expect(save).not.toHaveBeenCalled();
    unmount();
  });
});

function mount(setup: () => () => ReturnType<typeof h>) {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(defineComponent({ setup }));
  app.mount(container);
  return {
    container,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

function submit(form: HTMLFormElement): SubmitEvent {
  const submitter = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter });
  form.dispatchEvent(event);
  return event;
}
