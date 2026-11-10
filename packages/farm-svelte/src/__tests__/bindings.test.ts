// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";
import { createAction, createServerQuery } from "../bindings";

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

  it("loads server queries in the browser", async () => {
    const query = (async () => ({ email: "svelte@example.com" })) as ServerQuery<
      void,
      { email: string }
    >;
    const account = createServerQuery(query, undefined);
    let latest: { data?: { email: string }; status: string } | undefined;
    const unsubscribe = account.subscribe((snapshot) => (latest = snapshot));

    await vi.waitFor(() => expect(latest?.data).toEqual({ email: "svelte@example.com" }));
    expect(latest?.status).toBe("success");
    unsubscribe();
  });
});
