import { defineConfig } from "@farm.js/core";

export default defineConfig({
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
