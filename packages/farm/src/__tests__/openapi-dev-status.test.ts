import { describe, expect, it, vi } from "vitest";
import { reportOpenAPIDevGenerationResult } from "../openapi/dev-status";

describe("OpenAPI development status", () => {
  it("reports success only when generation returns a specification", () => {
    const output = { success: vi.fn(), warn: vi.fn() };

    reportOpenAPIDevGenerationResult(null, output);
    expect(output.success).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledWith(
      "OpenAPI documentation is enabled, but its specification failed to generate.",
    );

    output.warn.mockClear();
    reportOpenAPIDevGenerationResult({ openapi: "3.1.0" }, output);
    expect(output.success).toHaveBeenCalledWith("✅ OpenAPI documentation enabled");
    expect(output.warn).not.toHaveBeenCalled();
  });
});
