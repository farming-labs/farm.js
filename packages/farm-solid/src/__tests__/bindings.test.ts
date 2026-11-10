// @vitest-environment jsdom

import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";
import { useAction, useServerQuery } from "../bindings";

describe("Solid FARMJS bindings", () => {
  it("exposes action state through reactive getters", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const save = (async ({ name }: { name: string }) => ({ name })) as ServerFn<
          { name: string },
          { name: string }
        >;
        const action = useAction(save);

        const pending = action({ name: "Solid" });
        expect(action.pending).toBe(true);
        pending
          .then(() => {
            expect(action.status).toBe("success");
            expect(action.data).toEqual({ name: "Solid" });
            dispose();
            resolve();
          })
          .catch(reject);
      });
    });
  });

  it("keeps zero-argument actions callable", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const ping = (async () => "pong") as ServerFn<unknown, string>;
        const action = useAction(ping);

        action()
          .then((result) => {
            expect(result).toBe("pong");
            dispose();
            resolve();
          })
          .catch(reject);
      });
    });
  });

  it("loads server queries in the browser", async () => {
    const query = (async () => ({ email: "solid@example.com" })) as ServerQuery<
      void,
      { email: string }
    >;
    let dispose!: () => void;
    const account = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return useServerQuery(query, undefined);
    });

    await vi.waitFor(() => expect(account.data).toEqual({ email: "solid@example.com" }));
    expect(account.status).toBe("success");
    dispose();
  });
});
