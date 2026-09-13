import { fromMarkdown } from "mdast-util-from-markdown";
import { resolveContentAsset, type ContentAssetContext } from "./assets.js";
import type { ContentAssetValue } from "./types.js";

interface MarkdownPosition {
  readonly start: { readonly line: number; readonly column: number; readonly offset?: number };
  readonly end: { readonly line: number; readonly column: number; readonly offset?: number };
}

interface MarkdownNode {
  readonly type: string;
  readonly url?: string;
  readonly identifier?: string;
  readonly position?: MarkdownPosition;
  readonly children?: readonly MarkdownNode[];
}

interface MarkdownAssetCandidate {
  readonly kind: "image" | "file";
  readonly url: string;
  readonly position: MarkdownPosition;
  readonly definition: boolean;
}

interface MarkdownReplacement extends MarkdownAssetCandidate {
  readonly start: number;
  readonly end: number;
  readonly asset: ContentAssetValue;
}

const CONTENT_LINK_EXTENSIONS = new Set([".md", ".mdx"]);

export async function resolveMarkdownAssets(
  body: string,
  context: ContentAssetContext,
): Promise<{ body: string; assets: readonly ContentAssetValue[] }> {
  if (!body) return { body, assets: Object.freeze([]) };

  let tree: MarkdownNode;
  try {
    if (context.sourceFile.toLowerCase().endsWith(".mdx")) {
      // Parse MDX without evaluating it. Only Markdown children own assets.
      const [{ mdxFromMarkdown }, { mdxjs }] = await Promise.all([
        import("mdast-util-mdx"),
        import("micromark-extension-mdxjs"),
      ]);
      tree = fromMarkdown(body, {
        extensions: [mdxjs()],
        mdastExtensions: [mdxFromMarkdown()],
      }) as MarkdownNode;
    } else {
      tree = fromMarkdown(body) as MarkdownNode;
    }
  } catch (error) {
    throw new Error(
      `[farm:content] Could not inspect Markdown assets in ${context.sourceFile}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const candidates = collectCandidates(tree);
  const replacements: MarkdownReplacement[] = [];
  for (const candidate of candidates) {
    const range = findDestinationRange(body, candidate);
    if (!range) {
      throw new Error(
        `[farm:content] Could not locate the asset destination at ${context.sourceFile}:${candidate.position.start.line}:${candidate.position.start.column}`,
      );
    }
    const resolved = await resolveContentAsset(candidate.url, candidate.kind, context, [
      `body:${candidate.position.start.line}:${candidate.position.start.column}`,
    ]);
    replacements.push({ ...candidate, ...range, asset: resolved });
  }

  let output = body;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.asset.src}${output.slice(replacement.end)}`;
  }

  const uniqueAssets = new Map<string, ContentAssetValue>();
  for (const replacement of replacements) {
    uniqueAssets.set(`${replacement.asset.kind}:${replacement.asset.src}`, replacement.asset);
  }
  return { body: output, assets: Object.freeze([...uniqueAssets.values()]) };
}

function collectCandidates(tree: MarkdownNode): MarkdownAssetCandidate[] {
  const candidates: MarkdownAssetCandidate[] = [];
  const definitions = new Map<string, MarkdownNode>();
  const references = new Map<string, "image" | "file">();

  visit(tree, (node) => {
    if (node.type === "definition" && node.identifier) {
      // CommonMark resolves duplicate reference labels to their first definition.
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
      return;
    }
    if (node.type === "imageReference" && node.identifier) {
      references.set(node.identifier, "image");
      return;
    }
    if (node.type === "linkReference" && node.identifier && !references.has(node.identifier)) {
      references.set(node.identifier, "file");
      return;
    }
    if (node.type !== "image" && node.type !== "link") return;
    const kind = node.type === "image" ? "image" : "file";
    if (!isManagedReference(node.url, kind) || !node.position) return;
    candidates.push({ kind, url: node.url!, position: node.position, definition: false });
  });

  for (const [identifier, kind] of references) {
    const definition = definitions.get(identifier);
    if (!definition?.position || !isManagedReference(definition.url, kind)) continue;
    candidates.push({
      kind,
      url: definition.url!,
      position: definition.position,
      definition: true,
    });
  }

  return candidates.sort(
    (left, right) => (left.position.start.offset ?? 0) - (right.position.start.offset ?? 0),
  );
}

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function isManagedReference(value: string | undefined, kind: "image" | "file"): boolean {
  if (!value || !isRelativeReference(value)) return false;
  if (kind === "image") return true;

  const pathname = value.split(/[?#]/, 1)[0];
  const slash = pathname.lastIndexOf("/");
  const dot = pathname.lastIndexOf(".");
  if (dot <= slash) return false;
  return !CONTENT_LINK_EXTENSIONS.has(pathname.slice(dot).toLowerCase());
}

function isRelativeReference(value: string): boolean {
  return !(
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("#") ||
    value.startsWith("?") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  );
}

function findDestinationRange(
  body: string,
  candidate: MarkdownAssetCandidate,
): { start: number; end: number } | undefined {
  const nodeStart = candidate.position.start.offset;
  const nodeEnd = candidate.position.end.offset;
  if (nodeStart === undefined || nodeEnd === undefined) return undefined;
  const source = body.slice(nodeStart, nodeEnd);
  const relative = candidate.definition
    ? findDefinitionDestination(source)
    : findInlineDestination(source);
  if (!relative) return undefined;
  return { start: nodeStart + relative.start, end: nodeStart + relative.end };
}

function findInlineDestination(source: string): { start: number; end: number } | undefined {
  let index = source.startsWith("![") ? 2 : source.startsWith("[") ? 1 : -1;
  if (index < 0) return undefined;
  let brackets = 1;
  while (index < source.length && brackets > 0) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    index += 1;
  }
  if (brackets !== 0 || source[index] !== "(") return undefined;
  index += 1;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return readDestination(source, index, true);
}

function findDefinitionDestination(source: string): { start: number; end: number } | undefined {
  let index = 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "]") break;
    index += 1;
  }
  if (source[index] !== "]") return undefined;
  index += 1;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== ":") return undefined;
  index += 1;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return readDestination(source, index, false);
}

function readDestination(
  source: string,
  start: number,
  inline: boolean,
): { start: number; end: number } | undefined {
  if (source[start] === "<") {
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === ">") return { start: start + 1, end: index };
      index += 1;
    }
    return undefined;
  }

  let index = start;
  let parentheses = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      if (inline && parentheses === 0) break;
      if (parentheses > 0) parentheses -= 1;
    } else if (/\s/.test(character) && parentheses === 0) {
      break;
    }
    index += 1;
  }
  return index > start ? { start, end: index } : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
