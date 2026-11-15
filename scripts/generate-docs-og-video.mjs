import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { CARD_SIZE, docsRoot, openDocsOgCard } from "./docs-og-card.mjs";

const outputPath = join(docsRoot, "public", "videos", "farmjs-link-preview.mp4");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: CARD_SIZE, deviceScaleFactor: 2 });
  await openDocsOgCard(page);
  const { duration, fps } = await page.evaluate(() => ({
    duration: window.__card.DUR,
    fps: window.__card.FPS,
  }));

  // Requires ffmpeg built with libx264. The output is silent, as link previews play muted.
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-c:v",
      "png",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "veryslow",
      "-crf",
      "24",
      "-tune",
      "animation",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const exited = new Promise((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", resolve);
  });

  const frames = Math.round(duration * fps);
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate((time) => window.__card.render(time), frame / fps);
    const png = await page.screenshot({ type: "png" });
    if (!ffmpeg.stdin.write(png)) {
      await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
  }
  ffmpeg.stdin.end();

  const code = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
  console.log(`Generated ${outputPath} (${frames} frames at ${fps}fps)`);
} finally {
  await browser.close();
}
