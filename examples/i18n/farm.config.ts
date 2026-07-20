import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
  deploy: {
    target: "node",
  },
  i18n: {
    locales: ["en", "am", "ar"],
    defaultLocale: "en",
    fallbackLocale: "en",
    routing: "prefix-except-default",
    strict: true,
  },
});
