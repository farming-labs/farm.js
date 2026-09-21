import { defineConfig } from "@farm.js/core";
import { localStorage as fileStorage } from "@farm.js/core/storage";
import { sync } from "@farm.js/sync";
import { schema } from "./src/schema";

export default defineConfig({
  storage: {
    mounts: {
      // Any Farm storage driver works here: swap for sqlite, postgres, redis.
      app: fileStorage({ base: "./.farm/data" }),
    },
  },

  plugins: [
    sync({
      schema,
      storage: "app",
      models: {
        tasks: "write",
      },
      // Every read and write is filtered by this, server side. The demo scopes
      // by a per-browser list id instead of a login to stay runnable.
      where: ({ context }) => ({ listId: context.listId }),
      middleware: [
        ({ request }) => {
          const cookie = request.headers.get("cookie") ?? "";
          const match = cookie.match(/farm_list=([^;]+)/);
          return { listId: match?.[1] ?? "demo" };
        },
      ],
    }),
  ],
});
