import { describe, expect, it } from "vitest";
import { APITypeGenerator } from "../type-generator";

describe("APITypeGenerator", () => {
  it("quotes invalid TypeScript property keys in generated router types", () => {
    const generator = new APITypeGenerator("/tmp/app");

    const content = generator.generateAPIRouter([
      {
        path: "/api/storage-demo",
        methods: ["GET", "POST"],
        filePath: "/tmp/app/api/storage-demo/route.ts",
        relativePath: "api/storage-demo/route.ts",
      },
    ]);

    expect(content).toContain('"storage-demo": {');
    expect(content).toContain("get: typeof GET_storagedemo;");
    expect(content).toContain("post: typeof POST_storagedemo;");
  });
});
