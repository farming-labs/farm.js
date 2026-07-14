import { invalidate } from "@farmjs/core/cache";
import { createServerFn } from "@farmjs/core/server-fn";
import { createServerQuery } from "@farmjs/core/server-query";
import { z } from "zod";

let productVersion = 1;
let queryCalls = 0;

export const productQuery = createServerQuery({
  input: z.object({ id: z.string() }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number(),
    queryCalls: z.number(),
  }),
  key: ({ input }) => ["product", input.id],
  staleTime: "30s",
  async handler({ input }) {
    queryCalls++;
    return {
      id: input.id,
      name: `Farm product ${input.id}`,
      version: productVersion,
      queryCalls,
    };
  },
});

export const updateProduct = createServerFn({
  input: z.object({ id: z.string() }),
  output: z.object({ version: z.number() }),
  async handler({ input }) {
    productVersion++;
    invalidate(["product", input.id]);
    return { version: productVersion };
  },
});
