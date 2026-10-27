import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const docsRoot = join(repositoryRoot, "docs");
export const CARD_SIZE = { width: 1200, height: 630 };

const fontsRoot = join(docsRoot, "node_modules", "geist", "dist", "fonts");

/** The link preview card with its fonts and mark inlined, so it renders without a server. */
export async function loadDocsOgCard() {
  const [template, sansFont, monoFont, logo] = await Promise.all([
    readFile(join(repositoryRoot, "scripts", "docs-og-card.html"), "utf8"),
    readFile(join(fontsRoot, "geist-sans", "Geist-Variable.woff2")),
    readFile(join(fontsRoot, "geist-mono", "GeistMono-Variable.woff2")),
    readFile(join(docsRoot, "src", "assets", "farming-labs-logo-dark.svg"), "utf8"),
  ]);

  return template
    .replace("{{sansFont}}", () => `data:font/woff2;base64,${sansFont.toString("base64")}`)
    .replace("{{monoFont}}", () => `data:font/woff2;base64,${monoFont.toString("base64")}`)
    .replace("{{logo}}", () => logo.trim());
}

/** Loads the card into a Playwright page and waits for its fonts and first frame. */
export async function openDocsOgCard(page) {
  await page.setContent(await loadDocsOgCard(), { waitUntil: "load" });
  await page.waitForFunction(() => window.__card?.ready === true);
}
