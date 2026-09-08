import { defineConfig } from "@farm.js/core";
import { msw } from "@farm.js/msw";

export default defineConfig({
  plugins: [
    msw({
      handlers: "./src/mocks/handlers.ts",
    }),
  ],
});
