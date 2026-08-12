// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import { createAction } from "../bindings";

describe("Svelte FARMJS bindings", () => {
  it("exposes action state through a readable store", async () => {
    const save = (async ({ name }: { name: string }) => ({ name })) as ServerFn<
      { name: string },
      { name: string }
    >;
    const action = createAction(save);
    const statuses: string[] = [];
    const unsubscribe = action.subscribe((snapshot) => statuses.push(snapshot.status));

    await action({ name: "Svelte" });
    expect(statuses).toEqual(["idle", "pending", "success"]);
    unsubscribe();
  });

  it("keeps zero-argument actions callable", async () => {
    const action = createAction((async () => "pong") as ServerFn<unknown, string>);

    await expect(action()).resolves.toBe("pong");
  });
});
