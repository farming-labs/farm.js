import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-msw-test-handlers",
      resolveId(id) {
        return id === "virtual:farm-msw-handlers" ? `\0${id}` : undefined;
      },
      load(id) {
        return id === "\0virtual:farm-msw-handlers" ? "export const handlers = [];" : undefined;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    sequence: { concurrent: false },
  },
});
