import { join } from "node:path";
import { chromium } from "@playwright/test";
import { CARD_SIZE, docsRoot, openDocsOgCard } from "./docs-og-card.mjs";

const outputPath = join(docsRoot, "src", "app", "opengraph-image.png");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: CARD_SIZE, deviceScaleFactor: 1 });
  await openDocsOgCard(page);
  // The link preview video starts and ends on this frame, so the still matches it.
  await page.evaluate(() => window.__card.render(0));
  await page.screenshot({ path: outputPath, type: "png" });
  console.log(`Generated ${outputPath}`);
} finally {
  await browser.close();
}
