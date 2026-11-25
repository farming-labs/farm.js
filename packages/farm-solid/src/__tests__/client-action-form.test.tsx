import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import { useAction } from "../bindings";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Solid action forms in the browser", () => {
  it("submits the form's fields through the action and resets the form", async () => {
    const save = vi.fn(async (_data: FormData) => "saved") as unknown as ServerFn<FormData, string>;
    let action!: ReturnType<typeof useAction<FormData, string>>;
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => {
      action = useAction(save);
      return (
        <action.Form id="crop-form" class="crop">
          <input name="name" />
          <button type="submit" name="intent" value="publish">
            Publish
          </button>
        </action.Form>
      );
    }, container);

    const form = container.querySelector("form")!;
    expect(form.id).toBe("crop-form");
    expect(form.className).toBe("crop");
    expect(form.getAttribute("method")).toBe("post");
    form.querySelector("input")!.value = "wheat";

    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(action.status).toBe("success"));

    const data = vi.mocked(save).mock.calls[0]![0];
    expect(data.get("name")).toBe("wheat");
    expect(data.get("intent")).toBe("publish");
    expect(form.querySelector("input")!.value).toBe("");
    dispose();
  });

  it("runs the app's onSubmit first and skips the action when it cancels", async () => {
    const save = vi.fn(async () => "saved") as unknown as ServerFn<FormData, string>;
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => {
      const action = useAction(save);
      return (
        <action.Form onSubmit={onSubmit}>
          <input name="name" />
        </action.Form>
      );
    }, container);

    submit(container.querySelector("form")!);
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    dispose();
  });
});

function submit(form: HTMLFormElement): SubmitEvent {
  const submitter = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter });
  form.dispatchEvent(event);
  return event;
}
