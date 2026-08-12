import { readFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import type { Metadata, RouteModule } from "./types";
import type { ComponentType } from "react";
import { requestAcceptsMarkdown } from "./markdown";
import {
  resolveMdxConfig,
  type FarmMdxComponents,
  type FarmMdxResolvedConfig,
} from "./app-markdown-config";
export {
  resolveMdxConfig,
  type FarmMdxComponent,
  type FarmMdxComponents,
  type FarmMdxResolvedConfig,
  type FarmMdxUserConfig,
} from "./app-markdown-config";

export interface FarmMarkdownPageSource {
  source: string;
  filePath: string;
}

export interface FarmMarkdownPageModuleInput extends FarmMarkdownPageSource {
  components?: FarmMdxComponents;
  config?: FarmMdxResolvedConfig;
}

export function isFarmMarkdownPageFile(filePath: string): boolean {
  return /(^|[/\\])page\.mdx?$/i.test(filePath);
}

export function normalizeFarmMarkdownRoutePath(pathname: string): string {
  const withoutExtension = pathname.replace(/\.md$/i, "");
  const normalized = withoutExtension.startsWith("/") ? withoutExtension : `/${withoutExtension}`;
  return normalized === "/index" ? "/" : normalized.replace(/\/+$/g, "") || "/";
}

export function parseMarkdownFrontmatter(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!source.startsWith("---")) {
    return { frontmatter: {}, body: source };
  }

  const endIndex = source.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: source };
  }

  const frontmatterSource = source.slice(3, endIndex).trim();
  const closingFenceEnd = endIndex + "\n---".length;
  const bodyStart =
    source.slice(closingFenceEnd, closingFenceEnd + 2) === "\r\n"
      ? closingFenceEnd + 2
      : source[closingFenceEnd] === "\n"
        ? closingFenceEnd + 1
        : closingFenceEnd;
  const body = source.slice(bodyStart);
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterSource.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && value) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export function titleFromMarkdown(body: string, fallback?: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

export function createMarkdownMetadata(
  source: string,
  filePath: string,
): (Metadata & Record<string, any>) | undefined {
  const { frontmatter, body } = parseMarkdownFrontmatter(source);
  const routeTitle = titleFromMarkdown(body);
  const title = frontmatter.title || routeTitle;
  const description = frontmatter.description;

  if (!title && !description) {
    return undefined;
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    source: filePath,
  };
}

async function evaluateMdxSource(source: string, filePath: string) {
  const [{ evaluate }, runtime, remarkGfmModule] = await Promise.all([
    import("@mdx-js/mdx"),
    import("react/jsx-runtime"),
    import("remark-gfm"),
  ]);
  const remarkGfm = remarkGfmModule.default;

  return evaluate(source, {
    ...runtime,
    baseUrl: pathToFileURL(filePath),
    remarkPlugins: [remarkGfm],
  });
}

export function createFarmMarkdownRouteModule(
  input: FarmMarkdownPageModuleInput,
): RouteModule & { source: string } {
  const { body } = parseMarkdownFrontmatter(input.source);
  const components = input.components || {};
  const className = input.config?.className || "farm-markdown";
  let evaluatedPromise: Promise<{ default: ComponentType<any> }> | undefined;

  const loadContent = async () => {
    evaluatedPromise ??= evaluateMdxSource(body, input.filePath) as Promise<{
      default: ComponentType<any>;
    }>;
    return evaluatedPromise;
  };

  async function FarmMarkdownPage(props: any) {
    const { createElement } = await import("react");
    const evaluated = await loadContent();
    const MDXContent = evaluated.default;
    return createElement(
      "article",
      { className, "data-farm-markdown-page": "" },
      createElement(MDXContent, {
        ...props,
        components: {
          ...components,
          ...props?.components,
        },
      }),
    );
  }

  return {
    default: FarmMarkdownPage as unknown as RouteModule["default"],
    metadata: createMarkdownMetadata(input.source, input.filePath),
    source: input.source,
  };
}

export async function createFarmMarkdownRouteModuleFromFile(
  filePath: string,
  options: {
    components?: FarmMdxComponents;
    config?: FarmMdxResolvedConfig;
  } = {},
) {
  const source = await readFile(filePath, "utf8");
  return createFarmMarkdownRouteModule({
    source,
    filePath,
    components: options.components,
    config: options.config,
  });
}

export async function loadFarmMdxComponents(
  config: FarmMdxResolvedConfig | undefined,
  options: {
    root: string;
    loadModule?: (modulePath: string) => Promise<unknown>;
  },
): Promise<FarmMdxComponents> {
  const configured = config?.components;
  if (!configured) {
    return {};
  }

  if (typeof configured !== "string") {
    return configured;
  }

  const modulePath = path.isAbsolute(configured) ? configured : path.join(options.root, configured);
  const mod = options.loadModule
    ? await options.loadModule(modulePath)
    : await import(pathToFileURL(modulePath).href);
  const maybeModule = mod as {
    components?: FarmMdxComponents;
    default?: FarmMdxComponents;
  };

  return maybeModule.components || maybeModule.default || {};
}

export async function createFarmMarkdownSourceResponse(options: {
  request: Request;
  config?: FarmMdxResolvedConfig;
  resolveSource: (
    pathname: string,
  ) => Promise<FarmMarkdownPageSource | null> | FarmMarkdownPageSource | null;
}): Promise<Response | null> {
  if (options.request.method !== "GET" && options.request.method !== "HEAD") {
    return null;
  }
  if (options.config?.markdownRoutes === false) {
    return null;
  }

  const url = new URL(options.request.url);
  const hasMarkdownExtension = url.pathname.toLowerCase().endsWith(".md");
  if (!hasMarkdownExtension && !requestAcceptsMarkdown(options.request.headers.get("accept"))) {
    return null;
  }

  const targetPathname = normalizeFarmMarkdownRoutePath(url.pathname);
  const source = await options.resolveSource(targetPathname);
  if (!source) {
    return null;
  }

  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Location": targetPathname === "/" ? "/index.md" : `${targetPathname}.md`,
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    "X-Farm-Markdown-Route": targetPathname,
    "X-Farm-Markdown-Source": source.filePath,
  });
  if (!hasMarkdownExtension) {
    headers.set("Vary", "Accept");
  }

  return new Response(options.request.method === "HEAD" ? null : source.source, {
    status: 200,
    headers,
  });
}
