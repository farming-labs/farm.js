import { describe, expect, it } from "vitest";
import { renderOpenAPIReferenceHTML } from "../openapi/manager";
import {
  SCALAR_API_REFERENCE_SCRIPT,
  SCALAR_API_REFERENCE_STYLES,
  SCALAR_API_REFERENCE_VERSION,
} from "../openapi/scalar-assets";

describe("OpenAPI Scalar assets", () => {
  it("uses one exact, integrity-protected Scalar release", () => {
    const html = renderOpenAPIReferenceHTML(
      { openapi: "3.0.3", info: { title: "Test", version: "1" }, paths: {} },
      { title: "Test" },
    );

    expect(SCALAR_API_REFERENCE_VERSION).toBe("1.38.1");
    expect(SCALAR_API_REFERENCE_SCRIPT.url).toContain("@scalar/api-reference@1.38.1/");
    expect(SCALAR_API_REFERENCE_STYLES.url).toContain("@scalar/api-reference@1.38.1/");
    expect(html).toContain(`src="${SCALAR_API_REFERENCE_SCRIPT.url}"`);
    expect(html).toContain(`integrity="${SCALAR_API_REFERENCE_SCRIPT.integrity}"`);
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).not.toContain("@latest");
  });
});
