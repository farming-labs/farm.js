import { invalidate } from "@farm.js/core/cache";
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";
import { CROPS } from "./crops";

let planted = 0;

// Both run only on the server. A browser module that imports them gets references that post each
// call to the page (`experimental.serverActions` in farm.config.ts).
export const plantedCount = createServerQuery({
  key: () => ["planted"],
  async handler() {
    return { planted };
  },
});

export const plantCrop = createServerFn({
  input: z.object({ name: z.enum(CROPS) }),
  async handler({ input }) {
    planted += 1;
    // A plantedCount still on a page reads again.
    invalidate(["planted"]);
    return { message: `Planted ${input.name} on the server.` };
  },
});
