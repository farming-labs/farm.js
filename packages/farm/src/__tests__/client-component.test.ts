import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getClientModuleMetadata,
  hasHydrateExport,
  hasUseClientDirective,
  isClientComponentModule,
  resolveModuleSourcePath,
  shouldHydrateModule,
  stripUseClientDirective,
} from "../utils/client-component";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("client component path resolution", () => {
  it("detects and strips top-level client directives", () => {
    const source = '"use client";\n\nexport default function Page() { return null; }\n';

    expect(hasUseClientDirective(source)).toBe(true);
    expect(stripUseClientDirective(source)).toBe(
      "export default function Page() { return null; }\n",
    );
  });

  it("detects explicit hydrate exports", () => {
    expect(
      hasHydrateExport("export const hydrate = true;\nexport default function Page() {}"),
    ).toBe(true);
    expect(hasHydrateExport("const hydrate = true;\nexport default function Page() {}")).toBe(
      false,
    );
  });

  it("resolves project-relative /src module paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-path-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath("/src/app/demo/page.tsx", root)).toBe(sourceFile);
    expect(isClientComponentModule("/src/app/demo/page.tsx", root)).toBe(true);
  });

  it("supports absolute module paths directly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-abs-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "page.tsx");
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath(sourceFile, root)).toBe(sourceFile);
    expect(isClientComponentModule(sourceFile, root)).toBe(true);
  });

  it("supports file urls and Vite /@fs/ module ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-virtual-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "'use client';\nexport default function Page() { return null; }\n",
    );

    expect(resolveModuleSourcePath(`file://${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`file://${sourceFile}`, root)).toBe(true);
    expect(resolveModuleSourcePath(`/@fs${sourceFile}`, root)).toBe(sourceFile);
    expect(isClientComponentModule(`/@fs${sourceFile}`, root)).toBe(true);
  });

  it("supports hydratable server pages through export const hydrate = true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-hydrate-"));
    tempDirs.push(root);

    const sourceFile = path.join(root, "src", "app", "demo", "page.tsx");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      "export const hydrate = true;\nexport default function Page() { return null; }\n",
    );

    expect(getClientModuleMetadata(sourceFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
    });
    expect(isClientComponentModule(sourceFile, root)).toBe(false);
    expect(shouldHydrateModule(sourceFile, root)).toBe(true);
  });

  it("hydrates a server page automatically when it imports a client component", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-import-"));
    tempDirs.push(root);

    const pageFile = path.join(root, "src", "app", "demo", "page.tsx");
    const clientFile = path.join(root, "src", "app", "demo", "home-client.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(clientFile, '"use client";\nexport function HomeClient() { return null; }\n');
    fs.writeFileSync(
      pageFile,
      'import { HomeClient } from "./home-client";\nexport default function Page() { return <HomeClient />; }\n',
    );

    expect(getClientModuleMetadata(pageFile, root)).toEqual({
      isClientComponent: false,
      shouldHydrate: true,
    });
    expect(isClientComponentModule(pageFile, root)).toBe(false);
    expect(shouldHydrateModule(pageFile, root)).toBe(true);
  });

  it("uses a document swap when generated SPA navigation leaves the app root", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source).toContain("if (!this.swapContent(html))");
    expect(source).toContain("window.location.href = href;");
    expect(source).toContain("if (!newRoot || !currentRoot) return this.swapDocument(doc);");
    expect(source).toContain("swapDocument: function(doc)");
    expect(source).toContain("document.body.innerHTML = doc.body.innerHTML;");
    expect(source).toContain("delete window.__farmDocsRuntime;");
    expect(source).toContain("script.replaceWith(freshScript);");
    expect(source).toContain('document.documentElement.dataset.farmDocsRuntime === "true"');
    expect(source).toContain("this.swapContent(html, url.pathname + url.search)");
    expect(source).toContain(
      "const targetUrl = new URL(targetPath || window.location.href, window.location.origin);",
    );
    expect(source).toContain("resetReactRoot();");
  });

  it("keeps the generated production router compatible with client navigation hooks", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf-8",
    );

    expect(source).toContain("getNavigationState: function()");
    expect(source).toContain("subscribeNavigation: function(listener)");
    expect(source).toContain("addBlocker: function(blocker)");
    expect(source).toContain("registerScrollElement: function(key, element)");
    expect(source).toContain("writePageState: function(action, state, href)");
    expect(source).toContain("runViewTransition: async function(enabled, callback)");
    expect(source).toContain('const href = element.getAttribute("href");');
    expect(source).toContain("this.observers.set(element, observer);");
    expect(source).toContain("createHistoryState(");
    expect(source).toContain("currentPath: window.location.pathname + window.location.search");
    expect(source).toContain('if (action !== "pop" && to === this.currentPath)');
    expect(source).toContain("this.currentPath = to;");
  });

  it("uses a document swap when dev navigation enters the docs runtime", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "vite.ts"), "utf-8");
    const routerSource = fs.readFileSync(
      path.join(process.cwd(), "src", "client", "spa-router.ts"),
      "utf-8",
    );

    expect(source).toContain("if (!doc.documentElement || !doc.body) return false;");
    expect(source).toContain("document.head.innerHTML = doc.head ? doc.head.innerHTML : '';");
    expect(source).toContain("document.body.innerHTML = doc.body.innerHTML;");
    expect(source).toContain("delete window.__farmDocsRuntime;");
    expect(source).toContain("script.replaceWith(freshScript);");
    expect(source).toContain(
      "if (document.documentElement.dataset.farmDocsRuntime === 'true') return;",
    );
    expect(source).toContain(
      "async handlePopState(event) {\n    if (document.documentElement.dataset.farmDocsRuntime === 'true') return;",
    );
    expect(routerSource).toContain(
      'if (document.documentElement.dataset.farmDocsRuntime === "true") return;',
    );
  });
});
