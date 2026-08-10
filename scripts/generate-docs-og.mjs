import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(repositoryRoot, "docs");
const outputPath = join(docsRoot, "src", "app", "opengraph-image.png");

const [sansFont, monoFont, pixelFont, farmingLabsLogo] = await Promise.all([
  readFile(
    join(docsRoot, "node_modules", "geist", "dist", "fonts", "geist-sans", "Geist-Variable.woff2"),
  ),
  readFile(
    join(
      docsRoot,
      "node_modules",
      "geist",
      "dist",
      "fonts",
      "geist-mono",
      "GeistMono-Variable.woff2",
    ),
  ),
  readFile(
    join(
      docsRoot,
      "node_modules",
      "geist",
      "dist",
      "fonts",
      "geist-pixel",
      "GeistPixel-Square.woff2",
    ),
  ),
  readFile(join(docsRoot, "src", "assets", "farming-labs-logo-dark.svg"), "utf8"),
]);

const sansFontUrl = `data:font/woff2;base64,${sansFont.toString("base64")}`;
const monoFontUrl = `data:font/woff2;base64,${monoFont.toString("base64")}`;
const pixelFontUrl = `data:font/woff2;base64,${pixelFont.toString("base64")}`;
const logoUrl = `data:image/svg+xml;base64,${Buffer.from(farmingLabsLogo).toString("base64")}`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  await page.setContent(
    `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <style>
          @font-face {
            font-family: "Geist Sans";
            src: url("${sansFontUrl}") format("woff2");
            font-display: block;
            font-style: normal;
            font-weight: 100 900;
          }

          @font-face {
            font-family: "Geist Mono";
            src: url("${monoFontUrl}") format("woff2");
            font-display: block;
            font-style: normal;
            font-weight: 100 900;
          }

          @font-face {
            font-family: "Geist Pixel";
            src: url("${pixelFontUrl}") format("woff2");
            font-display: block;
            font-style: normal;
            font-weight: 400 700;
          }

          * { box-sizing: border-box; }

          html,
          body {
            width: 1200px;
            height: 630px;
            margin: 0;
            overflow: hidden;
          }

          body {
            color: #f5f5f4;
            background:
              linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px),
              #050505;
            background-size: 40px 40px;
            font-family: "Geist Mono", monospace;
            font-synthesis: none;
          }

          .canvas {
            position: relative;
            width: 100%;
            height: 100%;
            padding: 28px;
          }

          .frame {
            position: relative;
            display: grid;
            width: 100%;
            height: 100%;
            grid-template-rows: 86px 1fr 76px;
            overflow: hidden;
            border: 1px solid rgb(255 255 255 / 0.18);
            background: rgb(0 0 0 / 0.7);
          }

          .corner {
            position: absolute;
            z-index: 5;
            width: 10px;
            height: 10px;
          }

          .corner.tl { top: 20px; left: 20px; border-top: 1px solid #a3a3a3; border-left: 1px solid #a3a3a3; }
          .corner.tr { top: 20px; right: 20px; border-top: 1px solid #a3a3a3; border-right: 1px solid #a3a3a3; }
          .corner.bl { bottom: 20px; left: 20px; border-bottom: 1px solid #a3a3a3; border-left: 1px solid #a3a3a3; }
          .corner.br { right: 20px; bottom: 20px; border-right: 1px solid #a3a3a3; border-bottom: 1px solid #a3a3a3; }

          .header {
            display: flex;
            align-items: center;
            padding: 0 42px;
            border-bottom: 1px solid rgb(255 255 255 / 0.14);
          }

          .brand {
            display: flex;
            align-items: center;
            gap: 18px;
          }

          .brand img {
            width: 43px;
            height: 41px;
            object-fit: contain;
          }

          .brand-name {
            font-size: 23px;
            font-weight: 400;
            letter-spacing: 0;
            text-transform: uppercase;
          }

          .brand-name span { color: rgb(255 255 255 / 0.52); }

          .brand-by {
            margin-top: 5px;
            color: #8b8b8b;
            font-size: 10px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .main {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 390px;
          }

          .message {
            display: flex;
            min-width: 0;
            flex-direction: column;
            justify-content: center;
            padding: 36px 48px 38px 42px;
          }

          .eyebrow {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 19px;
            color: #a3a3a3;
            font-size: 12px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }

          .eyebrow-index {
            color: #f5f5f4;
          }

          .eyebrow-rule {
            width: 38px;
            height: 1px;
            background: #595959;
          }

          h1 {
            max-width: 690px;
            margin: 0;
            color: #f5f5f4;
            font-family: "Geist Pixel", "Geist Mono", monospace;
            font-size: 58px;
            font-weight: 500;
            line-height: 0.98;
            letter-spacing: -0.04em;
          }

          h1 span { display: block; }

          .summary {
            max-width: 640px;
            margin: 23px 0 0;
            color: #a3a3a3;
            font-family: "Geist Sans", sans-serif;
            font-size: 17px;
            font-weight: 420;
            line-height: 1.48;
            letter-spacing: -0.02em;
          }

          .architecture {
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 40px 38px;
            border-left: 1px solid rgb(255 255 255 / 0.14);
            background:
              repeating-linear-gradient(
                135deg,
                transparent 0,
                transparent 8px,
                rgb(255 255 255 / 0.026) 8px,
                rgb(255 255 255 / 0.026) 9px
              ),
              #030303;
          }

          .architecture-label {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 19px;
            color: #8b8b8b;
            font-size: 10px;
            letter-spacing: 0.11em;
            text-transform: uppercase;
          }

          .architecture-label strong {
            color: #f5f5f4;
            font-weight: 500;
          }

          .layer {
            display: grid;
            grid-template-columns: 44px 1fr;
            gap: 12px;
            margin-top: 12px;
          }

          .layer-mark,
          .layer-body {
            min-height: 62px;
            border-radius: 3px;
          }

          .layer-mark {
            display: grid;
            place-items: center;
            color: #050505;
            font-size: 11px;
            font-weight: 650;
          }

          .layer-body {
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 11px 15px;
            color: #050505;
          }

          .layer-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.07em;
            text-transform: uppercase;
          }

          .layer-items {
            margin-top: 6px;
            font-size: 9px;
            font-weight: 580;
            letter-spacing: 0.03em;
            opacity: 0.66;
          }

          .layer.product .layer-mark,
          .layer.product .layer-body { background: #f5f5f4; }
          .layer.application .layer-mark,
          .layer.application .layer-body { background: #a3a3a3; }
          .layer.platform .layer-mark,
          .layer.platform .layer-body { background: #595959; color: #f5f5f4; }
          .layer.platform .layer-items { opacity: 0.72; }

          .architecture-note {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid rgb(255 255 255 / 0.11);
            color: #8b8b8b;
            font-size: 10px;
            line-height: 1.55;
            letter-spacing: 0.05em;
            text-transform: uppercase;
          }

          .architecture-note strong { color: #f5f5f4; font-weight: 500; }

          .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 42px;
            border-top: 1px solid rgb(255 255 255 / 0.14);
            background: #080808;
          }

          .command {
            color: #a3a3a3;
            font-size: 13px;
            letter-spacing: -0.02em;
          }

          .command .prompt { margin-right: 12px; color: #f5f5f4; }
          .command strong { color: #f5f5f4; font-weight: 520; }

          .url {
            color: #f5f5f4;
            font-size: 12px;
            letter-spacing: 0.05em;
          }
        </style>
      </head>
      <body>
        <main class="canvas">
          <span class="corner tl"></span>
          <span class="corner tr"></span>
          <span class="corner bl"></span>
          <span class="corner br"></span>

          <section class="frame">
            <header class="header">
              <div class="brand">
                <img src="${logoUrl}" alt="" />
                <div>
                  <div class="brand-name">FARM<span>.JS</span></div>
                  <div class="brand-by">by Farming Labs</div>
                </div>
              </div>
            </header>

            <div class="main">
              <section class="message">
                <div class="eyebrow">
                  <span class="eyebrow-index">00</span>
                  <span class="eyebrow-rule"></span>
                  <span>Build / Ship / Scale</span>
                </div>
                <h1>
                  <span>a framework for</span>
                  <span>product-integrated apps</span>
                </h1>
                <p class="summary">
                  Routing, typed APIs, middleware, integrations, docs, and deployment—connected as one product.
                </p>
              </section>

              <aside class="architecture">
                <div class="architecture-label">
                  <strong>One product</strong>
                </div>

                <div class="layer product">
                  <div class="layer-mark">01</div>
                  <div class="layer-body">
                    <div class="layer-title">Product surface</div>
                    <div class="layer-items">UI · ROUTES · DOCS</div>
                  </div>
                </div>
                <div class="layer application">
                  <div class="layer-mark">02</div>
                  <div class="layer-body">
                    <div class="layer-title">Application core</div>
                    <div class="layer-items">TYPED APIs · MIDDLEWARE</div>
                  </div>
                </div>
                <div class="layer platform">
                  <div class="layer-mark">03</div>
                  <div class="layer-body">
                    <div class="layer-title">Connected stack</div>
                    <div class="layer-items">DATA · AUTH · DEPLOY</div>
                  </div>
                </div>

                <div class="architecture-note"><strong>Bring your stack.</strong> Farm.js makes it work together.</div>
              </aside>
            </div>

            <footer class="footer">
              <div class="command"><span class="prompt">$</span><strong>pnpm create @farm.js/app@beta</strong> my-app</div>
              <div class="url">farmjs.dev</div>
            </footer>
          </section>
        </main>
      </body>
    </html>`,
    { waitUntil: "load" },
  );

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outputPath, type: "png" });
  console.log(`Generated ${outputPath}`);
} finally {
  await browser.close();
}
