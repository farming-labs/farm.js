import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import type { EntryContext } from "../types.js";
import { generateClientEntry } from "./client.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: "/src/app/globals.css",
  actionsEnabled: true,
  serverActions: {
    allowedOrigins: ["https://proxy.example.com"],
    bodySizeLimit: 500_000,
  },
  deploymentId: "release-2",
  debug: false,
};

describe("generated server action security", () => {
  it("imports an existing global stylesheet into the browser asset graph", () => {
    const entry = generateClientEntry(context);

    expect(entry).toContain(
      'const farmGlobalStylesheets = import.meta.glob("/src/app/globals.css", {',
    );
    expect(entry).toContain("eager: true");
    expect(entry).toContain("import: 'default'");
    expect(entry).toContain("query: '?url'");
    expect(entry).toContain("export const farmGlobalStylesheet");
    expect(generateClientEntry({ ...context, globalCssPath: undefined })).not.toContain(
      "globals.css",
    );
  });

  it("validates and bounds requests before decoding or executing actions", () => {
    const entry = generateRscEntry(context);

    expect(entry).toContain("from '@farmjs/core/server-action-security'");
    expect(entry).toContain(
      'const serverActionSecurity = {"allowedOrigins":["https://proxy.example.com"],"bodySizeLimit":500000};',
    );
    expect(entry).toContain("await prepareServerActionRequest(");
    expect(entry.indexOf("validateServerActionRequest(request")).toBeLessThan(
      entry.indexOf("const middlewareResult = await executeMiddleware(request"),
    );
    expect(entry.indexOf("await prepareServerActionRequest(")).toBeLessThan(
      entry.indexOf("await decodeReply("),
    );
    expect(entry).toContain("await runWithServerActionRequest(request");
    expect(entry).toContain("sanitizeServerActionError(e)");
    expect(entry).toContain("headers.set('cache-control', 'no-store')");
    const outerCatch = entry.lastIndexOf("} catch (err) {");
    const sanitizedPostFailure = entry.indexOf(
      "return new Response('Server function failed'",
      outerCatch,
    );
    expect(outerCatch).toBeGreaterThan(-1);
    expect(sanitizedPostFailure).toBeGreaterThan(outerCatch);
    expect(entry.slice(outerCatch, sanitizedPostFailure)).toContain(
      "if (request.method === 'POST')",
    );
    expect(entry).not.toContain("returnValue = { ok: false, data: e }");
  });

  it("keeps browser action requests same-origin and turns failures into Errors", () => {
    const entry = generateClientEntry(context);

    expect(entry).toContain("credentials: 'same-origin'");
    expect(entry).toContain("redirect: 'error'");
    expect(entry).toContain("cache: 'no-store'");
    expect(entry).toContain("error.name = 'ServerActionError'");
    expect(entry).not.toContain("throw p.returnValue?.data");
  });

  it("emits the resolved global stylesheet URL for every routes directory shape", () => {
    const defaultEntry = generateClientEntry(context);
    const customEntry = generateClientEntry({
      ...context,
      globalCssPath: "/src/routes/globals.css",
      routesDir: " routes ",
    });
    const rootEntry = generateClientEntry({
      ...context,
      globalCssPath: "/src/globals.css",
      routesDir: "",
    });

    expect(defaultEntry).toContain(
      'const farmGlobalStylesheets = import.meta.glob("/src/app/globals.css", {',
    );
    expect(customEntry).toContain('import.meta.glob("/src/routes/globals.css", {');
    expect(rootEntry).toContain('import.meta.glob("/src/globals.css", {');
  });

  it("uses the shared middleware runtime and server context during RSC rendering", () => {
    const entry = generateRscEntry(context);

    expect(entry).toContain("createProductionMiddlewareRunner");
    expect(entry).toContain("path: middlewarePathToRoute(filePath)");
    expect(entry).toContain("const middlewareContext = middlewareResult.context");
    expect(entry).toContain("_runWithMiddlewareData(middlewareResult.data");
    expect(entry).toContain("_runWithMiddlewareContext(middlewareContext");
    expect(entry).toContain("middlewareHeaders.set('cache-control', 'private, no-store')");
  });

  it("bundles production API routes and dispatches them outside the server-action pipeline", () => {
    const entry = generateRscEntry(context);

    expect(entry).toContain(
      'import.meta.glob("/src/app/api/**/route.{tsx,jsx,ts,js}", { eager: true })',
    );
    expect(entry).toContain("getProgrammaticApiRoutes(routeModule)");
    expect(entry).toContain("from '@farmjs/core/api/runtime'");
    expect(entry).toContain("invokeAPIRouteEndpoint(endpoint, request, match.params)");
    expect(entry).toContain("error: 'Internal Server Error'");
    expect(entry).not.toContain("error?.message || 'Internal Server Error'");
    expect(entry).toContain("if (request.method === 'POST' && !isInitialApiRequest)");
    expect(entry).toContain("applyProductionMiddlewareHeaders(apiResponse, middlewareHeaders)");

    const apiClassification = entry.indexOf("const initialApiMatch = matchAPIRoute(");
    const actionValidation = entry.indexOf("validateServerActionRequest(request");
    const middleware = entry.indexOf("const middlewareResult = await executeMiddleware(request");
    const apiDispatch = entry.indexOf(
      "const apiResponse = await handleAPIRequest(request.clone())",
    );
    const actionDecode = entry.indexOf("await prepareServerActionRequest(");
    expect(apiClassification).toBeGreaterThan(-1);
    expect(apiClassification).toBeLessThan(actionValidation);
    expect(actionValidation).toBeLessThan(middleware);
    expect(middleware).toBeLessThan(apiDispatch);
    expect(apiDispatch).toBeLessThan(actionDecode);
  });

  it("merges layout/page metadata and clears stale document metadata during navigation", () => {
    const serverEntry = generateRscEntry(context);
    const clientEntry = generateClientEntry(context);

    const rootToNestedLayouts = serverEntry.indexOf(
      "for (let depth = 0; depth <= parts.length; depth++)",
    );
    const layoutMetadata = serverEntry.indexOf(
      "...LayoutModules.map((layoutModule) => layoutModule.metadata)",
    );
    const pageMetadata = serverEntry.indexOf("pageMetadata,", layoutMetadata);
    expect(rootToNestedLayouts).toBeGreaterThan(-1);
    expect(layoutMetadata).toBeGreaterThan(-1);
    expect(layoutMetadata).toBeLessThan(pageMetadata);

    const mergeStart = serverEntry.indexOf("function mergeDocumentMetadata(...sources)");
    const mergeEnd = serverEntry.indexOf("\n}\n\n/**\n * Find every applicable", mergeStart) + 2;
    const mergeDocumentMetadata = new Function(
      `${serverEntry.slice(mergeStart, mergeEnd)}; return mergeDocumentMetadata;`,
    )() as (...sources: Array<{ title?: string; description?: string } | undefined>) => {
      title?: string;
      description?: string;
    };
    expect(
      mergeDocumentMetadata(
        { title: "Root", description: "Root description" },
        { title: "Nested" },
        { description: "Page description" },
      ),
    ).toEqual({ title: "Nested", description: "Page description" });
    expect(mergeDocumentMetadata(undefined, {})).toEqual({});

    const layoutsStart = serverEntry.indexOf("function getLayoutModules(pageFilePath)");
    const layoutsEnd = serverEntry.indexOf("\n}\n\n/**\n * Main request handler", layoutsStart) + 2;
    const applicableLayouts = new Function(`
      const root = { default() {}, metadata: { title: 'Root' } };
      const nested = { default() {}, metadata: { description: 'Nested description' } };
      const nearest = { default() {}, metadata: { title: 'Nearest' } };
      const layouts = {
        '/layout.tsx': root,
        '/team/layout.tsx': nested,
        '/team/settings/layout.tsx': nearest,
      };
      ${serverEntry.slice(layoutsStart, layoutsEnd)};
      return getLayoutModules('/team/settings/page.tsx');
    `)() as Array<{ metadata: { title?: string; description?: string } }>;
    expect(applicableLayouts.map(({ metadata }) => metadata)).toEqual([
      { title: "Root" },
      { description: "Nested description" },
      { title: "Nearest" },
    ]);

    expect(serverEntry).toContain("title: typeof metadata?.title === 'string'");
    expect(serverEntry).toContain("description: typeof metadata?.description === 'string'");
    expect(clientEntry).toContain("document.title = payload.metadata.title");
    expect(clientEntry).toContain("document.title = ''");
    expect(clientEntry).toContain(
      "description.setAttribute('content', payload.metadata.description)",
    );
    expect(clientEntry).toContain("description?.remove()");
  });

  it("rejects stale actions before decoding and only reloads safe navigation", () => {
    const serverEntry = generateRscEntry(context);
    const clientEntry = generateClientEntry(context);

    expect(serverEntry).toContain('const farmDeploymentId = "release-2"');
    expect(serverEntry).toContain("createFarmDeploymentCookie(");
    expect(serverEntry.indexOf("getFarmDeploymentMismatch(request")).toBeLessThan(
      serverEntry.indexOf("validateServerActionRequest(request"),
    );

    expect(clientEntry).toContain("createFarmDeploymentRequestHeaders(farmDeploymentId");
    expect(clientEntry).toContain("throw reportDeploymentMismatch(res)");
    expect(clientEntry).toContain("location.assign(url)");

    const actionStart = clientEntry.indexOf("setServerCallback(async");
    const actionEnd = clientEntry.indexOf("// Debug logging helper");
    const actionClient = clientEntry.slice(actionStart, actionEnd);
    expect(actionClient).not.toContain("location.assign(");
    expect(actionClient).not.toContain("location.reload(");
  });

  it("merges layer route roots before project routes", async () => {
    const entry = generateRscEntry({
      ...context,
      routeRoots: [
        {
          name: "admin-layer",
          base: "../../layers/admin/src/app",
          glob: "../../layers/admin/src/app",
        },
        {
          name: "project",
          base: "../../src/app",
          glob: "../../src/app",
        },
      ],
    });

    expect(entry).toContain(
      'import.meta.glob("../../layers/admin/src/app/**/page.{tsx,jsx,ts,js}"',
    );
    expect(entry).toContain('import.meta.glob("../../src/app/**/page.{tsx,jsx,ts,js}"');
    expect(entry.indexOf("modules: pages0")).toBeLessThan(entry.indexOf("modules: pages1"));
    expect(entry).toContain("merged[relative] = module");
    expect(entry).toContain(
      'name: "admin-layer", base: "../../layers/admin/src", modules: routeDefinitionModules0',
    );
    expect(entry).toContain('name: "project", base: "../../src", modules: routeDefinitionModules1');
    await expect(
      transformWithEsbuild(entry, "layered-entry.rsc.tsx", { loader: "tsx" }),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });

  it("keeps distinct layer/project root APIs and overrides only matching route methods", () => {
    const entry = generateRscEntry({
      ...context,
      routeRoots: [
        {
          name: "base-layer",
          base: "../../layers/base/src/app",
          glob: "../../layers/base/src/app",
        },
        {
          name: "project",
          base: "../../src/app",
          glob: "../../src/app",
        },
      ],
    });

    const collectStart = entry.indexOf("function collectRouteModuleEntries(sources)");
    const collectEnd = entry.indexOf("\n}\n\nconst pages", collectStart) + 2;
    const collectRouteModuleEntries = new Function(
      `${entry.slice(collectStart, collectEnd)}; return collectRouteModuleEntries;`,
    )() as (
      sources: Array<{
        name: string;
        base: string;
        modules: Record<string, unknown>;
      }>,
    ) => Array<{
      sourceIndex: number;
      sourceName: string;
      filePath: string;
      relativePath: string;
      module: Record<string, any>;
    }>;

    const layerOnly = Object.assign(() => "layer", {
      __path: "/api/layer-only",
      __method: "GET",
    });
    const layerShared = Object.assign(() => "layer-shared", {
      __path: "/api/shared",
      __method: "GET",
    });
    const projectOnly = Object.assign(() => "project", {
      __path: "/api/project-only",
      __method: "GET",
    });
    const projectShared = Object.assign(() => "project-shared", {
      __path: "/api/shared",
      __method: "GET",
    });
    const projectSharedPost = Object.assign(() => "project-post", {
      __path: "/api/shared",
      __method: "POST",
    });

    const modules = collectRouteModuleEntries([
      {
        name: "base-layer",
        base: "../../layers/base/src",
        modules: {
          "../../layers/base/src/routes.ts": { layerOnly, layerShared },
        },
      },
      {
        name: "project",
        base: "../../src",
        modules: {
          "../../src/routes.ts": {
            projectOnly,
            projectShared,
            projectSharedPost,
          },
        },
      },
    ]);

    expect(modules.map(({ sourceIndex, sourceName }) => [sourceIndex, sourceName])).toEqual([
      [0, "base-layer"],
      [1, "project"],
    ]);

    const registryStart = entry.indexOf("const apiRouteMethods =");
    const registryEnd = entry.indexOf("\n\nregisterApiRouteSources(apiRouteModules", registryStart);
    const { apiRouteMap, registerApiRouteSources } = new Function(
      `${entry.slice(registryStart, registryEnd)}; return { apiRouteMap, registerApiRouteSources };`,
    )() as {
      apiRouteMap: Map<string, { handlers: Record<string, Function> }>;
      registerApiRouteSources: (
        fileModules: unknown[],
        definitionModules: typeof modules,
        sourceCount: number,
      ) => void;
    };

    registerApiRouteSources([], modules, 2);

    expect(apiRouteMap.get("/api/layer-only")?.handlers.GET).toBe(layerOnly);
    expect(apiRouteMap.get("/api/project-only")?.handlers.GET).toBe(projectOnly);
    expect(apiRouteMap.get("/api/shared")?.handlers.GET).toBe(projectShared);
    expect(apiRouteMap.get("/api/shared")?.handlers.POST).toBe(projectSharedPost);
  });

  it("keeps project precedence when layer and project APIs use different discovery styles", () => {
    const entry = generateRscEntry({
      ...context,
      routeRoots: [
        {
          name: "base-layer",
          base: "../../layers/base/src/app",
          glob: "../../layers/base/src/app",
        },
        {
          name: "project",
          base: "../../src/app",
          glob: "../../src/app",
        },
      ],
    });

    const registryStart = entry.indexOf("const apiRouteMethods =");
    const registryEnd = entry.indexOf("\n\nregisterApiRouteSources(apiRouteModules", registryStart);
    const { apiRouteMap, registerApiRouteSources } = new Function(
      `${entry.slice(registryStart, registryEnd)}; return { apiRouteMap, registerApiRouteSources };`,
    )() as {
      apiRouteMap: Map<string, { handlers: Record<string, Function> }>;
      registerApiRouteSources: (
        fileModules: Array<{
          sourceIndex: number;
          filePath: string;
          relativePath: string;
          module: Record<string, Function>;
        }>,
        definitionModules: Array<{
          sourceIndex: number;
          filePath: string;
          module: Record<string, Function>;
        }>,
        sourceCount: number,
      ) => void;
    };

    const layerProgrammatic = Object.assign(() => "layer-programmatic", {
      __path: "/api/project-file-wins",
      __method: "GET",
    });
    const projectFile = () => "project-file";
    const layerFile = () => "layer-file";
    const projectProgrammatic = Object.assign(() => "project-programmatic", {
      __path: "/api/project-programmatic-wins",
      __method: "GET",
    });

    registerApiRouteSources(
      [
        {
          sourceIndex: 0,
          filePath: "../../layers/base/src/app/api/project-programmatic-wins/route.ts",
          relativePath: "/api/project-programmatic-wins/route.ts",
          module: { GET: layerFile },
        },
        {
          sourceIndex: 1,
          filePath: "../../src/app/api/project-file-wins/route.ts",
          relativePath: "/api/project-file-wins/route.ts",
          module: { GET: projectFile },
        },
      ],
      [
        {
          sourceIndex: 0,
          filePath: "../../layers/base/src/routes.ts",
          module: { layerProgrammatic },
        },
        {
          sourceIndex: 1,
          filePath: "../../src/routes.ts",
          module: { projectProgrammatic },
        },
      ],
      2,
    );

    expect(apiRouteMap.get("/api/project-file-wins")?.handlers.GET).toBe(projectFile);
    expect(apiRouteMap.get("/api/project-programmatic-wins")?.handlers.GET).toBe(
      projectProgrammatic,
    );
  });

  it("emits syntactically valid RSC and browser entries", async () => {
    await expect(
      transformWithEsbuild(generateRscEntry(context), "entry.rsc.tsx", {
        loader: "tsx",
      }),
    ).resolves.toMatchObject({ code: expect.any(String) });
    await expect(
      transformWithEsbuild(generateClientEntry(context), "entry.browser.tsx", {
        loader: "tsx",
      }),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });
});
