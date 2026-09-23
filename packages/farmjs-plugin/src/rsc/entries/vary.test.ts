import { expect, it } from "vitest";
import { generateRscEntry } from "./rsc.js";

const entry = generateRscEntry({
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "test",
  debug: false,
});
const start = entry.indexOf("function applyActionResponseHeaders(");
const end = entry.indexOf("// Auto-discover all route modules", start);
const apply = new Function(
  "farmDeploymentId",
  "createFarmDeploymentCookie",
  `${entry.slice(start, end)}; return applyActionResponseHeaders;`,
)("test", () => "deployment=test");

it.each(["text/html", "text/x-component"])(
  "varies %s pages by Accept without losing fields",
  (accept) => {
    const request = new Request("https://farm.test/", { headers: { accept } });
    for (const [value, expected] of [
      ["", "Accept"],
      ["Origin", "Origin, Accept"],
      ["aCcEpT, Origin", "aCcEpT, Origin"],
      ["*", "*"],
    ]) {
      const headers = new Headers(value ? { vary: value } : {});
      apply(headers, request);
      expect(headers.get("vary")).toBe(expected);
    }
  },
);

it("keeps action responses non-cacheable", () => {
  const headers = new Headers({ "cache-control": "public, max-age=60" });
  apply(
    headers,
    new Request("https://farm.test/", { method: "POST", headers: { accept: "text/x-component" } }),
  );
  expect(headers.get("vary")).toBe("Accept");
  expect(headers.get("cache-control")).toBe("no-store");
});
