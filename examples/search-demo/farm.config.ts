import { defineConfig } from "@farm.js/core";
import { search } from "@farm.js/search";

export default defineConfig({
  plugins: [
    search({
      include: ["/", "/guides/**"],
      exclude: ["/account/**"],
    }),
  ],
});
