import { defineConfig } from "@farm.js/core";

export default defineConfig({
  // A backend-only app: API routes and middleware, no pages, and no React to install.
  renderer: false,
  // Serve src/app/api/** from the root, so /todos answers as well as /api/todos.
  api: { basePath: "/" },
  // Publish an OpenAPI document built from the createEndpoint schemas.
  openapi: { enabled: true },
});
