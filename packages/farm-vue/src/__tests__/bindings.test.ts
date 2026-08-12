// @vitest-environment jsdom

import { effectScope } from "vue";
import { describe, expect, it } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import { useAction } from "../bindings";

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
});
