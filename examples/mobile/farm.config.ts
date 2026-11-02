import { defineConfig } from "@farm.js/core";

export default defineConfig({
  i18n: {
    locales: ["en", "es"],
    defaultLocale: "en",
    fallbackLocale: "en",
    routing: "prefix-except-default",
    strict: true,
  },
  // Only `farm dev|build --mobile` and `farm config inspect --mobile` call this. A web build
  // never does, and strips the block like `desktop`.
  mobile: ({ command }) => ({
    name: "Farm Field Notes",
    id: "dev.farmjs.examples.fieldnotes",
    // The web deployment the app loads pages from. `farm dev --mobile` uses the dev server.
    server: command === "dev" ? undefined : (process.env.FIELD_NOTES_SERVER ?? "https://field-notes.farmjs.dev"),
    tabs: [
      { path: "/", title: "Home", icon: "house" },
      { path: "/notes", title: "Notes", icon: "note.text" },
      { path: "/settings", title: "Settings", icon: "gear" },
    ],
    routes: {
      // Each step renders in the screen that shows the wizard instead of pushing a new one.
      "/navigation/step/[n]": { presentation: "replace" },
    },
    native: {
      auto: "report",
      routes: {
        // /map is native (page.native.tsx) except on iOS, which keeps the web screen for now.
        "/map": { screen: "native", ios: "web" },
      },
      budgets: { appSizeMb: 12, screenOpenMs: 300, droppedFrames: 2 },
    },
  }),
});
