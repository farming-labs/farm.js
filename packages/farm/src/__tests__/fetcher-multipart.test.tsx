// @vitest-environment jsdom
import { act, createElement, type FormHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { useFetcher, type UseFetcherOptions, type UseFetcherReturn } from "../fetcher-client";
import type { TypedFormData } from "../api/transport";

type Router = {
  uploads: {
    post: {
      __types: {
        body: { attachment?: File; tags?: string[] };
        inputBody: TypedFormData<{ attachment?: File; tags?: string[] }>;
        query: never;
        response: { ok: boolean };
      };
    };
  };
};
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

async function setup(
  options: UseFetcherOptions<any> = {},
  formProps: FormHTMLAttributes<HTMLFormElement> = {},
) {
  const transport = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
  const api = createAPIClient<Router>({ baseURL: "https://farm.test", fetch: transport });
  let fetcher!: UseFetcherReturn<typeof api.uploads.post>;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  function App() {
    fetcher = useFetcher(api.uploads.post, options);
    return createElement(
      fetcher.Form,
      formProps,
      createElement("input", { name: "tags", defaultValue: "one" }),
      createElement("input", { name: "tags", defaultValue: "two" }),
      createElement("button", { name: "intent", value: "upload", type: "submit" }, "Upload"),
    );
  }
  await act(async () => root.render(createElement(App)));
  return {
    get fetcher() {
      return fetcher;
    },
    transport,
    form: container.querySelector("form")!,
  };
}

it.each(["submitAsync", "submit"] as const)(
  "preserves file bytes and repeated fields through %s",
  async (method) => {
    const app = await setup();
    const input = new FormData();
    const file = new File(["file contents"], "sample.txt", { type: "text/plain" });
    input.append("attachment", file);
    input.append("attachment", file);
    input.append("tags", "one");
    input.append("tags", "two");
    input.append("__proto__", "unsafe");
    input.append("constructor", "unsafe");
    input.append("prototype", "unsafe");
    await act(async () => {
      await app.fetcher[method](input);
    });
    const init = app.transport.mock.calls[0][1]!;
    expect(init.body).toBeInstanceOf(FormData);
    const sent = init.body as FormData;
    expect(sent.getAll("attachment")).toEqual([file, file]);
    expect(sent.getAll("tags")).toEqual(["one", "two"]);
    expect([...sent.keys()]).toEqual(["attachment", "attachment", "tags", "tags"]);
    expect(input.has("__proto__")).toBe(true);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(sent.get("attachment") as File);
    });
    expect(bytes).toBe("file contents");
  },
);

it.each(["form", "submitter"])(
  "honors multipart encoding from the %s for text-only forms",
  async (source) => {
    const app = await setup({}, source === "form" ? { encType: "multipart/form-data" } : {});
    const button = app.form.querySelector("button")!;
    if (source === "submitter") button.setAttribute("formenctype", "multipart/form-data");
    await act(async () => {
      app.form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }),
      );
    });
    const init = app.transport.mock.calls[0][1]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).getAll("tags")).toEqual(["one", "two"]);
    expect((init.body as FormData).get("intent")).toBe("upload");
  },
);

it("keeps text-only imperative submissions as JSON and respects custom mappers", async () => {
  const text = new FormData();
  text.append("tags", "one");
  text.append("tags", "two");
  const normal = await setup();
  await act(async () => {
    await normal.fetcher.submitAsync(text);
  });
  expect(normal.transport.mock.calls[0][1]!.body).toBe('{"tags":["one","two"]}');

  const input = new FormData();
  input.append("attachment", new File(["file"], "file.txt"));
  const mapFormData = vi.fn(() => ({ body: { tags: ["mapped"] } }));
  const mapped = await setup({ mapFormData });
  await act(async () => {
    await mapped.fetcher.submitAsync(input);
  });
  expect(mapFormData).toHaveBeenCalledWith(input, { form: null, submitter: null });
  expect(mapped.transport.mock.calls[0][1]!.body).toBe('{"tags":["mapped"]}');
});
