import { invalidate } from "@farm.js/core/cache";
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

let version = 1;
let calls = 0;

export const productQuery = createServerQuery({
  input: z.object({ id: z.string() }),
  key: ({ input }) => ["contract-product", input.id],
  staleTime: "30s",
  async handler({ input }) {
    calls++;
    return { id: input.id, version, calls };
  },
});

export const updateProduct = createServerFn({
  input: z.object({ id: z.string() }),
  async handler({ input }) {
    version++;
    invalidate(["contract-product", input.id]);
    return { version };
  },
});
