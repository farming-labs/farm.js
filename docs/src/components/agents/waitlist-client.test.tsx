// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWaitlist } from "./waitlist";
import { enhanceAgentWaitlist } from "./waitlist-client";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(AgentWaitlist, { source: "agents" }),
  );
  const root = document.querySelector<HTMLElement>("[data-agent-waitlist-root]")!;
  const form = root.querySelector("form")!;
  const button = root.querySelector("button")!;
  const email = root.querySelector("input")!;
  const status = root.querySelector('[role="status"]')!;
  email.value = "reader@example.com";
  dispose = enhanceAgentWaitlist(root);
  const submit = () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return { form, button, email, status, submit };
}

describe("waitlist button feedback", () => {
  it("keeps the pixel grid beside the pending label and prevents duplicate submissions", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { form, button, email, status, submit } = setup();
    const loader = button.querySelector(".agent-waitlist-loader");
    expect(loader).not.toBeNull();
    expect(loader?.children).toHaveLength(9);
    expect(loader?.getAttribute("aria-hidden")).toBe("true");
    expect(button.textContent).toBe("Join the waitlist");
    expect(button.getAttribute("aria-label")).toBe("Join the waitlist");

    submit();
    submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(email.readOnly).toBe(true);
    expect(button.textContent).toBe("Joining…");
    expect(button.getAttribute("aria-label")).toBe("Joining…");
    expect(button.querySelector(".agent-waitlist-loader")).toBe(loader);

    finish(Response.json({ ok: true, id: "test-only" }));
    await vi.waitFor(() => expect(form.hasAttribute("aria-busy")).toBe(false));
    expect(button.textContent).toBe("Join the waitlist");
    expect(button.getAttribute("aria-label")).toBe("Join the waitlist");
    expect(button.disabled).toBe(false);
    expect(email.readOnly).toBe(false);
    expect(email.value).toBe("");
    expect(status.textContent).toBe("");
    expect(button.querySelector(".agent-waitlist-loader")).toBe(loader);

    email.value = "another-reader@example.com";
    submit();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe("Joining…");
    finish(Response.json({ ok: true, id: "another-test-only" }));
    await vi.waitFor(() => expect(form.hasAttribute("aria-busy")).toBe(false));
    expect(button.textContent).toBe("Join the waitlist");
    expect(status.textContent).toBe("");
  });

  it.each(["server", "network", "rate-limit", "malformed"])(
    "restores the label and allows retry after a %s failure",
    async (failure) => {
      const fetch = vi
        .fn()
        .mockImplementationOnce(() => {
          if (failure === "network") return Promise.reject(new Error("offline"));
          if (failure === "malformed") return Promise.resolve(new Response("not json"));
          return Promise.resolve(
            Response.json({ ok: false }, { status: failure === "rate-limit" ? 429 : 503 }),
          );
        })
        .mockResolvedValue(Response.json({ ok: true, id: "retry-test-only" }));
      vi.stubGlobal("fetch", fetch);
      const { form, button, email, status, submit } = setup();
      submit();
      await vi.waitFor(() => expect(form.hasAttribute("aria-busy")).toBe(false));
      expect(button.textContent).toBe("Join the waitlist");
      expect(button.disabled).toBe(false);
      expect(email.readOnly).toBe(false);
      expect(email.value).toBe("reader@example.com");
      expect(button.querySelectorAll(".agent-waitlist-loader > span")).toHaveLength(9);
      expect(status.textContent).toContain(
        failure === "rate-limit" ? "Too many attempts" : "couldn't save",
      );
      submit();
      expect(button.textContent).toBe("Joining…");
      expect(status.textContent).toBe("");
      await vi.waitFor(() => expect(form.hasAttribute("aria-busy")).toBe(false));
      expect(button.textContent).toBe("Join the waitlist");
      expect(button.disabled).toBe(false);
      expect(email.value).toBe("");
      expect(status.textContent).toBe("");
    },
  );

  it("aborts pending work when navigating away without writing a late result", async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const { form, status, submit } = setup();
    submit();
    dispose?.();
    expect(signal?.aborted).toBe(true);
    expect(form.hidden).toBe(true);
    finish(Response.json({ ok: true, id: "late-test-only" }));
    await Promise.resolve();
    expect(status.textContent).toBe("");
  });
});
