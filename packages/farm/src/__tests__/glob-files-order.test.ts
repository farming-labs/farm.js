// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("tinyglobby", () => ({
  // The crawl's order, which differs between runs.
  glob: vi.fn(async () => ["app/notes/new/page.tsx", "app/lab/packing/page.tsx", "app/page.tsx"]),
}));

describe("globFiles", () => {
  it("lists the matches sorted, whatever order the crawl found them in", async () => {
    const { globFiles } = await import("../utils");
    expect(await globFiles("**/page.tsx", "/app")).toEqual([
      "app/lab/packing/page.tsx",
      "app/notes/new/page.tsx",
      "app/page.tsx",
    ]);
  });
});
