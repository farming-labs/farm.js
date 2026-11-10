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

it.each(["text/html", "text/x-component"])(
  "keeps %s pages out of shared caches by default",
  (accept) => {
    const headers = new Headers();
    apply(headers, new Request("https://farm.test/admin", { headers: { accept } }));
    expect(headers.get("cache-control")).toBe("private, no-store");
  },
);

it("keeps a Cache-Control that middleware set", () => {
  const headers = new Headers({ "cache-control": "public, max-age=60" });
  apply(headers, new Request("https://farm.test/", { headers: { accept: "text/x-component" } }));
  expect(headers.get("cache-control")).toBe("public, max-age=60");
});

it("applies the page headers to both the Flight and HTML responses", () => {
  const flight = entry.indexOf("responseHeaders.set('content-type', 'text/x-component');");
  const html = entry.indexOf("responseHeaders.set('content-type', 'text/html');", flight);
  for (const site of [flight, html]) {
    expect(site).toBeGreaterThan(-1);
    const next = entry.slice(site, entry.indexOf("return new Response(", site));
    expect(next).toContain("applyActionResponseHeaders(responseHeaders, request);");
  }
});
