export default defineNuxtConfig({
  compatibilityDate: "2026-07-01",
  srcDir: ".",
  css: ["~/assets/benchmark.css"],
  nitro: { preset: "node-server" },
  telemetry: false,
});
