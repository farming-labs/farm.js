// A docs site's shape: a navigation tree every page sends to its client sidebar, and
// articles whose text stays on the server. Generated, so every build sees the same bytes.
// Words from a seeded generator over English-like syllables: real docs text compresses about
// 3x with brotli, a small fixed vocabulary would compress far better and flatter every payload.
const SYLLABLES =
  "ca che ro ute ren der stre am ser ver cli ent lay out pa ge is land ac tion for que ry ad ap ter con fig de ploy pre set bu ild sta tic dy na mic re qu est spon se hea der coo kie ses sion to ken sche ma mo del ta ble in dex sea rch fil ter so rt li mit off set hy dra te na vi ga pre fe tch lo ad as set ima fo nt sty le the me lo cal mes sa er ror tri ti meo ut sig nal".split(
    " ",
  );

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function title(seed: number, words: number): string {
  const next = random(seed * 9973 + 17);
  const parts: string[] = [];
  for (let i = 0; i < words; i++) {
    let text = "";
    const syllables = 1 + Math.floor(next() * 3);
    for (let s = 0; s < syllables; s++) text += SYLLABLES[Math.floor(next() * SYLLABLES.length)];
    parts.push(text);
  }
  const text = parts.join(" ");
  return text[0]!.toUpperCase() + text.slice(1);
}

function word(seed: number): string {
  return title(seed, 1).toLowerCase();
}

export interface NavItem {
  title: string;
  href: string;
  description: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const tree: NavSection[] = Array.from({ length: 12 }, (_, section) => ({
  title: title(section + 100, 2),
  items: Array.from({ length: 25 }, (_, index) => {
    const n = section * 25 + index;
    return {
      title: title(n, 3),
      href: `/docs/p${n}`,
      description: `${title(n + 500, 6)}.`,
    };
  }),
}));

export const pages: NavItem[] = tree.flatMap((section) => section.items);

export interface Article {
  title: string;
  headings: { id: string; text: string }[];
  sections: { id: string; text: string; paragraphs: string[]; code: string }[];
}

export function getArticle(slug: string): Article | undefined {
  const n = Number(slug.slice(1));
  const page = pages[n];
  if (!slug.startsWith("p") || !page) return undefined;
  const sections = Array.from({ length: 5 }, (_, s) => {
    const text = title(n * 11 + s, 3);
    return {
      id: `s${s}`,
      text,
      paragraphs: Array.from(
        { length: 3 },
        (_, p) =>
          `${title(n * 31 + s * 7 + p, 12)}. ${title(n * 17 + s * 5 + p, 10)}, ${title(n + s + p, 8)}.`,
      ),
      code: `export default defineConfig({\n  ${word(n + s)}: { ${word(n * 3 + s)}: true },\n});`,
    };
  });
  return {
    title: page.title,
    headings: sections.map(({ id, text }) => ({ id, text })),
    sections,
  };
}
