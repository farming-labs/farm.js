/**
 * The parts of a renderer component file (`.vue`, `.svelte`) the mobile analyzer reads without
 * the renderer's compiler: its script blocks, its style blocks, and where its markup is. Offsets
 * are into the file, so positions found in a part are positions in the file. Build time only.
 */

export type FarmComponentKind = "vue" | "svelte";

export interface FarmComponentBlock {
  /** The block's content, from `start` to `end` in the file. */
  start: number;
  end: number;
  attributes: Record<string, string | true>;
}

export interface FarmComponentBlocks {
  kind: FarmComponentKind;
  scripts: FarmComponentBlock[];
  styles: FarmComponentBlock[];
  /** Where the markup is: Vue's top-level `<template>`; for Svelte, the file outside its blocks. */
  markup: Array<{ start: number; end: number }>;
}

export function farmComponentKind(file: string): FarmComponentKind | undefined {
  return file.endsWith(".vue") ? "vue" : file.endsWith(".svelte") ? "svelte" : undefined;
}

function readAttributes(text: string): Record<string, string | true> {
  const attributes: Record<string, string | true> = {};
  for (const match of text.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? true;
  }
  return attributes;
}

/** Top-level `<script>` and `<style>` blocks, and the top-level `<template>` (Vue). */
export function readFarmComponentBlocks(file: string, source: string): FarmComponentBlocks {
  const kind = farmComponentKind(file);
  if (!kind) throw new TypeError(`${file} is not a .vue or .svelte component`);
  const scripts: FarmComponentBlock[] = [];
  const styles: FarmComponentBlock[] = [];
  const taken: Array<{ start: number; end: number }> = [];
  for (const name of ["script", "style"] as const) {
    const open = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = open.exec(source))) {
      const start = match.index + match[0].length;
      const close = source.toLowerCase().indexOf(`</${name}>`, start);
      const end = close === -1 ? source.length : close;
      (name === "script" ? scripts : styles).push({
        start,
        end,
        attributes: readAttributes(match[1] ?? ""),
      });
      taken.push({ start: match.index, end: close === -1 ? end : close + name.length + 3 });
      open.lastIndex = end;
    }
  }
  taken.sort((left, right) => left.start - right.start);
  const markup: Array<{ start: number; end: number }> = [];
  if (kind === "svelte") {
    let cursor = 0;
    for (const range of taken) {
      if (range.start > cursor) markup.push({ start: cursor, end: range.start });
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < source.length) markup.push({ start: cursor, end: source.length });
  } else {
    // The first top-level <template>, to its matching close: templates nest (v-if, v-for, slots).
    const tag = /<(\/?)template\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/gi;
    let depth = 0;
    let start = -1;
    let match: RegExpExecArray | null;
    while ((match = tag.exec(source))) {
      if (taken.some((range) => match!.index >= range.start && match!.index < range.end)) continue;
      if (match[2]) continue;
      if (!match[1]) {
        if (depth === 0) start = match.index + match[0].length;
        depth += 1;
      } else if (depth > 0) {
        depth -= 1;
        if (depth === 0) {
          markup.push({ start, end: match.index });
          break;
        }
      }
    }
  }
  return { kind, scripts, styles, markup };
}

/**
 * The file with everything but `ranges` blanked: newlines stay, so a position found in the result
 * is the same line and column in the file.
 */
export function keepFarmComponentRanges(
  source: string,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): string {
  let out = "";
  let cursor = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    out += blank(source.slice(cursor, range.start)) + source.slice(range.start, range.end);
    cursor = range.end;
  }
  return out + blank(source.slice(cursor));
}

/**
 * The script that holds a component's module exports, such as `export const mobile` or
 * `export const hydrate`: Vue's plain `<script>` (not `setup`), Svelte's `<script module>` (or
 * Svelte 4's `context="module"`).
 */
export function farmComponentModuleScripts(blocks: FarmComponentBlocks): FarmComponentBlock[] {
  return blocks.scripts.filter((script) =>
    blocks.kind === "vue"
      ? script.attributes.setup === undefined
      : script.attributes.module !== undefined || script.attributes.context === "module",
  );
}
