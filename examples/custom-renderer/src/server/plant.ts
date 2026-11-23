import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";
import { CROPS } from "./crops";

let planted = 0;

// Runs only on the server. A browser module that imports it gets a reference that posts the call
// to the page (`experimental.serverActions` in farm.config.ts).
export const plantCrop = createServerFn({
  input: z.object({ name: z.enum(CROPS) }),
  async handler({ input }) {
    planted += 1;
    return { message: `Planted ${input.name} on the server.`, planted };
  },
});
