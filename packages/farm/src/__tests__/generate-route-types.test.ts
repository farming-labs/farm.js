import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ts from "typescript";
import { generateRouteTypes } from "../routing/generate-route-types";

function readTypeAlias(content: string, name: string): string {
  return content.match(new RegExp(`export type ${name} =([\\s\\S]*?);`))?.[1] ?? "";
}

describe("generateRouteTypes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-route-types-"));
    const appDir = path.join(tmpDir, "src", "app");
    await fs.promises.mkdir(path.join(appDir, "about"), { recursive: true });
    await fs.promises.mkdir(path.join(appDir, "content"), { recursive: true });
    await fs.promises.mkdir(path.join(appDir, "users", "[id]"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(appDir, "page.tsx"),
      "export default function Home() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(appDir, "about", "page.tsx"),
      "export default function About() { return null; }",
    );
    await fs.promises.writeFile(path.join(appDir, "content", "page.mdx"), "# Content");
    await fs.promises.writeFile(
      path.join(appDir, "users", "[id]", "page.tsx"),
      "export default function User() { return null; }",
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes farm-routes.d.ts with RoutePath and module augmentation", async () => {
    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    expect(outPath).toBe(path.join(tmpDir, "src", "farm-routes.d.ts"));

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("export type RoutePath =");
    expect(content).toContain("export type RoutePattern =");
    expect(content).toContain("export type RouteModulePattern =");
    expect(content).toContain('"/"');
    expect(content).toContain('"/about"');
    expect(content).toContain('"/content"');
    expect(content).toContain("LinkDefaultRoute");
    expect(content).toContain('declare module "@farm.js/core/client"');
    expect(content).toContain('declare module "@farm.js/core"');
    expect(content).toContain('declare module "@farm.js/core/dist/client.js"');
    expect(content).toContain('_: import("./farm-routes").RoutePath');
    expect(content).toContain('pattern: import("./farm-routes").RoutePattern');
    expect(content).toContain("namespace FarmJS");
    expect(content).toContain("interface RouteRegistry");
  });

  it("discovers renderer-owned Vue route components", async () => {
    const reportsDir = path.join(tmpDir, "src", "app", "reports");
    await fs.promises.mkdir(reportsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(reportsDir, "page.vue"),
      "<template><main>Reports</main></template>",
    );

    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      componentExtensions: [".vue"],
    });
    const content = fs.readFileSync(outPath, "utf8");

    expect(readTypeAlias(content, "RoutePath")).toContain('"/reports"');
  });

  it("discovers renderer-owned Svelte route components", async () => {
    const dashboardDir = path.join(tmpDir, "src", "app", "dashboard");
    await fs.promises.mkdir(dashboardDir, { recursive: true });
    await fs.promises.writeFile(path.join(dashboardDir, "page.svelte"), "<main>Dashboard</main>");

    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      componentExtensions: [".svelte"],
    });
    const content = fs.readFileSync(outPath, "utf8");

    expect(readTypeAlias(content, "RoutePath")).toContain('"/dashboard"');
  });

  it("types route-slot targets without exposing slot directory syntax", async () => {
    const feedDir = path.join(tmpDir, "src", "app", "feed");
    const photoDir = path.join(feedDir, "photo", "[id]");
    const modalDir = path.join(feedDir, "@modal", "(.)photo", "[id]");
    const activityDir = path.join(feedDir, "@activity");
    await fs.promises.mkdir(photoDir, { recursive: true });
    await fs.promises.mkdir(modalDir, { recursive: true });
    await fs.promises.mkdir(activityDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(feedDir, "page.tsx"),
      "export default function Feed() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(photoDir, "page.tsx"),
      "export default function Photo() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(modalDir, "page.tsx"),
      "export default function Modal() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(activityDir, "page.tsx"),
      "export default function Activity() { return null; }",
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain('"/feed"');
    expect(content).toContain("`/feed/photo/${string}`");
    expect(content).not.toContain("@modal");
    expect(content).not.toContain("@activity");
    expect(content).not.toContain("(.)photo");
  });

  it("types grouped routes at their group-free URLs", async () => {
    const marketingDir = path.join(tmpDir, "src", "app", "(marketing)", "pricing");
    const appGroupDir = path.join(tmpDir, "src", "app", "(app)", "dashboard");
    await fs.promises.mkdir(marketingDir, { recursive: true });
    await fs.promises.mkdir(appGroupDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(marketingDir, "page.tsx"),
      "export default function Pricing() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(appGroupDir, "page.tsx"),
      "export default function Dashboard() { return null; }",
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(readTypeAlias(content, "RoutePath")).toContain('"/pricing"');
    expect(readTypeAlias(content, "RoutePath")).toContain('"/dashboard"');
    expect(content).not.toContain("(marketing)");
    expect(content).not.toContain("(app)");
  });

  it("when suppressLintOnLink is true, disables Link linting but keeps route module props typed", async () => {
    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      suppressLintOnLink: true,
    });
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("export type RoutePath = string");
    expect(content).toContain("export type RoutePattern = string");
    const routeModulePattern = readTypeAlias(content, "RouteModulePattern");
    expect(routeModulePattern).toContain('"/"');
    expect(routeModulePattern).toContain('"/about"');
    expect(content).toContain("interface RouteRegistry");
    expect(content).not.toContain("LinkDefaultRoute");
  });

  it("regenerates when a new page is added", async () => {
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    let content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).not.toContain("/blog");

    await fs.promises.mkdir(path.join(tmpDir, "src", "app", "blog"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(tmpDir, "src", "app", "blog", "page.tsx"),
      "export default function Blog() { return null; }",
    );
    await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    content = fs.readFileSync(path.join(tmpDir, "src", "farm-routes.d.ts"), "utf8");
    expect(content).toContain('"/blog"');
  });

  it("includes configured extra routes in the generated union", async () => {
    const outPath = await generateRouteTypes({
      root: tmpDir,
      srcDir: "src",
      extraRoutes: ["/docs/reference", "/docs", "/docs/[...docs]"],
    });

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain('"/docs/reference"');
    expect(content).toContain('"/docs"');
    expect(content).toContain('"/docs/[...docs]"');
    expect(content).toContain("`/docs/${string}`");
  });

  it("includes the base and nested URLs for an optional catch-all page", async () => {
    const routeDir = path.join(tmpDir, "src", "app", "docs", "[[...slug]]");
    await fs.promises.mkdir(routeDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(routeDir, "page.tsx"),
      "export default function Docs() { return null; }",
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");
    const routePath = readTypeAlias(content, "RoutePath");
    const routePattern = readTypeAlias(content, "RoutePattern");

    expect(routePath).toContain('"/docs"');
    expect(routePath).toContain("`/docs/${string}`");
    expect(routePattern).toContain('"/"');
    expect(routePattern).toContain('"/about"');
    expect(content).toContain('"/docs/[[...slug]]"');
  });

  it("includes literal page paths from programmatic route files", async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, "src", "farm.routes.ts"),
      `
import { defineRoutes } from "@farm.js/core/routes";
import { MarketingPage } from "./marketing-page";

export default defineRoutes(({ page }) => [
  page("/marketing/[slug]", { component: MarketingPage }),
]);
`,
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain("`/marketing/${string}`");
    expect(content).toContain('"/marketing/[slug]"');
  });

  it("includes literal createRoute paths from normal feature files", async () => {
    const productRouteFile = path.join(tmpDir, "src", "features", "products", "page.tsx");
    await fs.promises.mkdir(path.dirname(productRouteFile), {
      recursive: true,
    });
    await fs.promises.writeFile(
      productRouteFile,
      `
import { createRoute } from "@farm.js/core/routes";

function ProductPage() {
  return null;
}

export const ProductRoute = createRoute("/products/[id]", {
  component: ProductPage,
});
`,
    );

    const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const content = fs.readFileSync(outPath, "utf8");

    expect(content).toContain("`/products/${string}`");
    expect(content).toContain('"/products/[id]"');
  });

  it("types page, layout, metadata, state, and static params from generated routes", async () => {
    const docsDir = path.join(tmpDir, "src", "app", "docs", "[[...slug]]");
    const dashboardDir = path.join(tmpDir, "src", "app", "dashboard");
    await fs.promises.mkdir(docsDir, { recursive: true });
    await fs.promises.mkdir(dashboardDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(docsDir, "page.tsx"),
      "export default function Docs() { return null; }",
    );
    await fs.promises.writeFile(
      path.join(dashboardDir, "layout.tsx"),
      "export default function DashboardLayout({ children }) { return children; }",
    );
    const reportsRoutePath = path.join(tmpDir, "src", "features", "reports.tsx");
    await fs.promises.mkdir(path.dirname(reportsRoutePath), { recursive: true });
    await fs.promises.writeFile(
      reportsRoutePath,
      `
import { createRoute } from "@farm.js/core/routes";
export const ReportsRoute = createRoute("/reports/[year]", {
  component: () => null,
});
`,
    );

    const generatedTypesPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
    const typeTestPath = path.join(tmpDir, "route-props.type-test.ts");
    await fs.promises.writeFile(
      typeTestPath,
      `
import type {
  AppRoutePattern,
  ErrorProps,
  GenerateStaticParams,
  LayoutMetadataProps,
  LayoutProps,
  LoadingProps,
  MetadataProps,
  PageProps,
} from "@farm.js/core";
import type { PageProps as ClientPageProps } from "@farm.js/core/client";

const route: AppRoutePattern = "/users/[id]";
void route;
// @ts-expect-error only generated route patterns are accepted
const missingRoute: AppRoutePattern = "/missing";
void missingRoute;

declare const page: PageProps<"/users/[id]">;
const pageId: string = page.params.id;
void pageId;
// @ts-expect-error only parameters declared by this route exist
page.params.slug;

declare const programmaticPage: PageProps<"/reports/[year]">;
declare const clientPage: ClientPageProps<"/users/[id]">;
const generatedIds: string[] = [programmaticPage.params.year, clientPage.params.id];
void generatedIds;

declare const layout: LayoutProps<"/users/[id]">;
declare const layoutOnlyRoute: LayoutProps<"/dashboard">;
declare const layoutMetadata: LayoutMetadataProps<"/users/[id]">;
declare const metadata: MetadataProps<"/users/[id]">;
declare const loading: LoadingProps<"/users/[id]">;
declare const error: ErrorProps<"/users/[id]">;
const typedIds: string[] = [
  layout.params.id,
  layoutMetadata.params.id,
  metadata.params.id,
  loading.params.id,
  error.params.id,
];
void typedIds;
void layoutOnlyRoute;

declare const docs: PageProps<"/docs/[[...slug]]">;
const docsSlug: string | undefined = docs.params.slug;
void docsSlug;

declare const legacyPage: PageProps;
const unknownParam: string = legacyPage.params.anything;
void unknownParam;

const generateUsers: GenerateStaticParams<"/users/[id]"> = async () => [{ id: 1 }];
const generateDocs: GenerateStaticParams<"/docs/[[...slug]]"> = () => [
  {},
  { slug: ["guides", "routing"] },
];
void generateUsers;
void generateDocs;

// @ts-expect-error dynamic static params require id
const missingUserId: GenerateStaticParams<"/users/[id]"> = () => [{}];
void missingUserId;
// @ts-expect-error catch-all static params use path segment arrays
const invalidDocsSlug: GenerateStaticParams<"/docs/[[...slug]]"> = () => [{ slug: "guides" }];
void invalidDocsSlug;
// @ts-expect-error route literals are checked against generated patterns
type MissingPage = PageProps<"/missing">;
declare const missingPage: MissingPage;
void missingPage;
`,
    );

    const program = ts.createProgram({
      rootNames: [generatedTypesPath, typeTestPath],
      options: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        baseUrl: process.cwd(),
        paths: {
          "@farm.js/core": ["./src/types.ts"],
          "@farm.js/core/client": ["./types/client.d.ts"],
          "@farm.js/core/routes": ["./src/routes.ts"],
        },
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const formattedDiagnostics = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });

    expect(formattedDiagnostics).toBe("");
  }, 30_000);

  it("writes a valid empty route union when no pages exist", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-empty-route-types-"));
    try {
      await fs.promises.mkdir(path.join(root, "src", "app"), {
        recursive: true,
      });

      const outPath = await generateRouteTypes({ root, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain("export type RoutePath = never;");
      expect(content).toContain("export type RoutePattern = never;");
      expect(content).toContain("export type RouteModulePattern = never;");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
