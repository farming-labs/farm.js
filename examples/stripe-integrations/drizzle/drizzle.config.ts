import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./farm-integrations.generated.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./drizzle.sqlite",
  },
});
