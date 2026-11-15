import { describe, expect, it } from "vitest";
import {
  createFarmApiCatalog,
  createFarmApiCatalogResponse,
  resolveFarmApiCatalogInput,
} from "../api-catalog";
import { normalizeFarmAPIConfig } from "../api/config";

const api = normalizeFarmAPIConfig(undefined);

describe("api catalog", () => {
  it("lists the OpenAPI description and the MCP endpoint", () => {
    const input = resolveFarmApiCatalogInput({
      api,
      openapi: { enabled: true, specRoute: "/openapi.json", route: "/docs/reference" },
      mcp: { enabled: true },
    });
    expect(createFarmApiCatalog(input)).toEqual({
      linkset: [
        {
          anchor: "/.well-known/api-catalog",
          item: [{ href: "/api" }, { href: "/api/mcp" }],
        },
        {
          anchor: "/api",
          "service-desc": [{ href: "/openapi.json", type: "application/vnd.oai.openapi+json" }],
          "service-doc": [{ href: "/docs/reference", type: "text/html" }],
        },
      ],
    });
  });

  it("follows the basePath, the public API path and OpenAPI servers", () => {
    const input = resolveFarmApiCatalogInput({
      basePath: "/workspace",
      api: normalizeFarmAPIConfig({ baseURL: "/v1" }),
      openapi: { enabled: true, specRoute: "/openapi.json", route: false },
      mcp: { path: "/api/tools" },
    });
    expect(createFarmApiCatalog(input).linkset).toEqual([
      {
        anchor: "/workspace/.well-known/api-catalog",
        item: [{ href: "/v1" }, { href: "/v1/tools" }],
      },
      {
        anchor: "/v1",
        "service-desc": [
          { href: "/workspace/openapi.json", type: "application/vnd.oai.openapi+json" },
        ],
      },
    ]);

    const external = resolveFarmApiCatalogInput({
      api,
      openapi: {
        enabled: true,
        specRoute: "/openapi.json",
        servers: [{ url: "https://api.example.com/v2" }],
      },
    });
    expect(createFarmApiCatalog(external).linkset[1]!.anchor).toBe("https://api.example.com/v2");
  });

  it("leaves out surfaces that are off", () => {
    const input = resolveFarmApiCatalogInput({
      api,
      openapi: { enabled: false, specRoute: "/openapi.json", route: "/docs/reference" },
      mcp: { enabled: false },
    });
    expect(createFarmApiCatalog(input)).toEqual({
      linkset: [{ anchor: "/.well-known/api-catalog", item: [] }],
    });
    expect(resolveFarmApiCatalogInput({ api, mcp: false }).mcpPath).toBeUndefined();
  });

  it("answers GET with the Linkset and HEAD with only the api-catalog Link", async () => {
    const input = resolveFarmApiCatalogInput({ api, mcp: {} });
    const get = createFarmApiCatalogResponse("GET", input);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    expect(get.headers.get("link")).toBe('</.well-known/api-catalog>; rel="api-catalog"');
    expect((await get.json()).linkset[0].item).toEqual([{ href: "/api/mcp" }]);

    const head = createFarmApiCatalogResponse("HEAD", input);
    expect(head.status).toBe(200);
    expect(head.headers.get("link")).toBe('</.well-known/api-catalog>; rel="api-catalog"');
    expect(await head.text()).toBe("");

    const post = createFarmApiCatalogResponse("POST", input);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});
