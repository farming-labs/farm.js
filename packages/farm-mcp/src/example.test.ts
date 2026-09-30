// @vitest-environment node
import { expect, it, vi } from "vitest";

it("shares demo data when config and routes load the module independently", async () => {
  const route = await import("../../../examples/api-mcp/src/lib/projects");
  vi.resetModules();
  const config = await import("../../../examples/api-mcp/src/lib/projects");
  expect(config).not.toBe(route);
  const project = { id: "shared-store-test", name: "Shared demo data", status: "planned" as const };
  route.projects.push(project);
  try {
    expect(config.projects.find(({ id }) => id === project.id)).toBe(project);
  } finally {
    route.projects.splice(route.projects.indexOf(project), 1);
  }
});
