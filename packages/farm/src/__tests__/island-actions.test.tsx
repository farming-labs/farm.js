import React, { act, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setFarmActionId } from "../client/action-reference";
import {
  createFarmIsolatedClientBoundary,
  createFarmIsolatedHydrationRuntime,
} from "../client/isolated-boundary";
import { createFarmServerTreeElement, renderFarmServerTreePage } from "../client/server-tree";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A registered `"use server"` export, as the islands transform leaves it on the server.
async function addTodo(formData: FormData) {
  return String(formData.get("title"));
}
setFarmActionId(addTodo, "add-todo-id");

function TodoFormSource({
  action,
  count,
}: {
  action: (formData: FormData) => Promise<unknown>;
  count: number;
}) {
  const [clicks, setClicks] = useState(0);
  return (
    <form action={action as never}>
      <output data-count>{`${count} todos`}</output>
      <button type="button" data-clicks onClick={() => setClicks(clicks + 1)}>
        {`clicks ${clicks}`}
      </button>
    </form>
  );
}
const TodoForm = createFarmIsolatedClientBoundary(
  React,
  TodoFormSource,
  "/src/todo-form.tsx",
  "TodoForm",
  "load",
  { slots: true, values: true },
);

const stubs = new Map<string, (...args: unknown[]) => unknown>();
const actions = (id: string) => {
  let stub = stubs.get(id);
  if (!stub) {
    stub = vi.fn(async () => `called ${id}`);
    stubs.set(id, stub);
  }
  return stub;
};
function createRuntime() {
  return createFarmIsolatedHydrationRuntime({
    ReactRuntime: React,
    hydrateRoot,
    load: async () => ({ __farm_client_boundary_originals__: { TodoForm: TodoFormSource } }),
    schedule: async ({ hydrate }) => hydrate(),
    actions,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  stubs.clear();
  vi.restoreAllMocks();
});

describe("server actions as island props", () => {
  it("sends an action as a reference and hydrates it as a callable stub", async () => {
    const html = renderToString(<TodoForm action={addTodo} count={2} />);
    const props = JSON.parse(/data-farm-client-props="[^"]+">([^<]*)<\/script>/.exec(html)![1]!);
    expect(props.action).toEqual({ $farmAction: "add-todo-id" });
    expect(html).not.toContain("formData.get");

    document.body.innerHTML = html;
    const runtime = createRuntime();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => runtime.hydrate(document));
    expect(runtime.rootCount()).toBe(1);
    expect(errors).not.toHaveBeenCalled();

    await act(async () => {
      document.querySelector("form")!.requestSubmit();
    });
    expect(stubs.get("add-todo-id")).toHaveBeenCalledOnce();
    expect((stubs.get("add-todo-id") as any).mock.calls[0][0]).toBeInstanceOf(FormData);
  });

  it("keeps a function that is not an action out, as before", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToString(<TodoForm action={async () => {}} count={1} />);
    expect(html).not.toContain("farm-client-boundary");
  });

  it("keeps an island's state across a refresh and gives it the new props", async () => {
    document.body.innerHTML = `<main id="current">${renderToString(
      <TodoForm action={addTodo} count={2} />,
    )}</main>`;
    const runtime = createRuntime();
    await act(async () => runtime.hydrate(document));
    const live = document.querySelector("farm-client-boundary")!;
    await act(async () => (document.querySelector("[data-clicks]") as HTMLButtonElement).click());
    expect(document.querySelector("[data-clicks]")!.textContent).toBe("clicks 1");

    // The refreshed page, as the server renders it after the action.
    const next = document.createElement("main");
    next.innerHTML = renderToString(<TodoForm action={addTodo} count={3} />);
    let carried = 0;
    await act(async () => {
      carried = runtime.carryOver(document.querySelector("#current")!, next);
    });
    expect(carried).toBe(1);
    expect(next.querySelector("farm-client-boundary")).toBe(live);
    document.querySelector("#current")!.replaceWith(next);
    await act(async () => runtime.hydrate(document));

    expect(runtime.rootCount()).toBe(1);
    expect(document.querySelector("[data-count]")!.textContent).toBe("3 todos");
    expect(document.querySelector("[data-clicks]")!.textContent).toBe("clicks 1");
  });

  it("does not carry an island over to a different component", async () => {
    document.body.innerHTML = `<main id="current">${renderToString(
      <TodoForm action={addTodo} count={2} />,
    )}</main>`;
    const runtime = createRuntime();
    await act(async () => runtime.hydrate(document));
    const Other = createFarmIsolatedClientBoundary(
      React,
      TodoFormSource,
      "/src/other.tsx",
      "Other",
      "load",
      { slots: true, values: true },
    );
    const next = document.createElement("main");
    next.innerHTML = renderToString(<Other action={addTodo} count={3} />);
    expect(runtime.carryOver(document.querySelector("#current")!, next)).toBe(0);
  });

  it("passes an action through a server tree payload", async () => {
    async function Page() {
      await Promise.resolve();
      return <TodoFormSourceBoundary />;
    }
    function TodoFormSourceBoundary() {
      return <TodoForm action={addTodo} count={4} />;
    }
    const page = await renderFarmServerTreePage(React, <Page />, {
      isolate: (node) => node,
    });
    const html = renderToString(<div id="__farm_page__">{page}</div>);
    expect(html).toContain('{"$":"a","i":"add-todo-id"}');
    const container = Object.assign(document.createElement("div"), { innerHTML: html });
    const element = await createFarmServerTreeElement(
      React,
      container.querySelector("#__farm_page__")!,
      {
        load: async () => ({ __farm_client_boundary_originals__: { TodoForm: TodoFormSource } }),
        ServerHtml: () => null,
        actions,
      },
    );
    const target = document.createElement("div");
    document.body.append(target);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(target);
    await act(async () => root.render(element));
    expect(target.querySelector("[data-count]")!.textContent).toBe("4 todos");
    await act(async () => target.querySelector("form")!.requestSubmit());
    expect(stubs.get("add-todo-id")).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
