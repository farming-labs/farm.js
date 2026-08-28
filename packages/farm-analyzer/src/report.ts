import {
  formatBytes,
  type AnalyzerAsset,
  type AnalyzerBuildReport,
  type AnalyzerLimitViolation,
  type AnalyzerPage,
  type AnalyzerSizes,
} from "./analyze.js";

export function renderAnalyzerReport(
  report: AnalyzerBuildReport,
  violations: AnalyzerLimitViolation[] = [],
): string {
  const metric = report.metric;
  const largestPageSize = Math.max(...report.pages.map((page) => page.sizes[metric]), 1);
  const otherPublicAssets = report.publicAssets.filter(
    (asset) => asset.kind !== "script" && asset.kind !== "style",
  );
  const metricLabel = metric === "raw" ? "Raw" : metric === "gzip" ? "Gzip" : "Brotli";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Farm build analyzer</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f5;
      --panel: rgba(255, 255, 255, 0.88);
      --panel-solid: #fff;
      --text: #181a18;
      --muted: #6a716b;
      --line: #dfe4df;
      --line-soft: #ebeeeb;
      --accent: #38a169;
      --accent-strong: #237a4b;
      --accent-soft: #e5f5eb;
      --danger: #c9362b;
      --danger-soft: #fff0ee;
      --shadow: 0 18px 50px rgba(24, 35, 26, 0.07);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c0e0d;
        --panel: rgba(20, 23, 21, 0.9);
        --panel-solid: #141715;
        --text: #f2f5f2;
        --muted: #9ca59e;
        --line: #2b312d;
        --line-soft: #222724;
        --accent: #6bd994;
        --accent-strong: #8ce7ad;
        --accent-soft: #172b20;
        --danger: #ff8d83;
        --danger-soft: #321b19;
        --shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 18% -10%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 34rem),
        var(--bg);
      color: var(--text);
      font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 80px; }
    header { display: flex; justify-content: space-between; gap: 32px; align-items: flex-start; margin-bottom: 34px; }
    .eyebrow { display: flex; align-items: center; gap: 10px; color: var(--accent-strong); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
    .mark { width: 18px; height: 18px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px; transform: rotate(45deg); }
    .mark span { background: var(--accent); border-radius: 2px; }
    h1 { margin: 12px 0 8px; font-size: clamp(32px, 5vw, 54px); line-height: 1.05; letter-spacing: -.045em; }
    .subtitle { margin: 0; color: var(--muted); max-width: 680px; font-size: 16px; }
    .meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .pill { white-space: nowrap; padding: 7px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); background: var(--panel); }
    .pill strong { color: var(--text); font-weight: 650; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 26px; }
    .card, section, .notice { border: 1px solid var(--line); background: var(--panel); box-shadow: var(--shadow); backdrop-filter: blur(18px); }
    .card { border-radius: 16px; padding: 18px; }
    .card-label { color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; }
    .card-value { margin-top: 10px; font-size: 25px; font-weight: 720; letter-spacing: -.035em; }
    .card-note { margin-top: 3px; color: var(--muted); font-size: 12px; }
    .notice { border-radius: 14px; padding: 16px 18px; margin-bottom: 18px; }
    .notice.danger { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); background: var(--danger-soft); }
    .notice-title { font-weight: 720; margin-bottom: 4px; }
    .notice p, .notice ul { margin: 0; color: var(--muted); }
    .notice ul { padding: 8px 0 0 20px; }
    section { border-radius: 18px; overflow: hidden; margin-top: 18px; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 22px 16px; }
    h2 { margin: 0; font-size: 17px; letter-spacing: -.015em; }
    .section-description { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
    .search { width: min(260px, 40vw); border: 1px solid var(--line); background: var(--panel-solid); color: var(--text); border-radius: 9px; padding: 8px 11px; outline: none; }
    .search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 22px; border-top: 1px solid var(--line-soft); text-align: right; white-space: nowrap; }
    th { color: var(--muted); font-size: 11px; letter-spacing: .055em; text-transform: uppercase; font-weight: 680; }
    th:first-child, td:first-child { text-align: left; width: 100%; }
    td:first-child { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .primary-size { color: var(--accent-strong); font-weight: 720; }
    .route-row { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(180px, 2fr) 78px; align-items: center; gap: 18px; padding: 13px 22px; border-top: 1px solid var(--line-soft); }
    .route-name { overflow: hidden; text-overflow: ellipsis; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .bar-track { height: 8px; border-radius: 999px; background: var(--line-soft); overflow: hidden; }
    .bar { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent-strong), var(--accent)); min-width: 3px; }
    .route-size { text-align: right; font-weight: 680; }
    .empty { color: var(--muted); padding: 24px 22px; border-top: 1px solid var(--line-soft); }
    footer { color: var(--muted); display: flex; justify-content: space-between; gap: 20px; margin-top: 26px; font-size: 12px; }
    footer code { color: var(--text); }
    [hidden] { display: none !important; }
    @media (max-width: 820px) {
      main { width: min(100% - 24px, 1180px); padding-top: 32px; }
      header { display: block; }
      .meta { justify-content: flex-start; margin-top: 18px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .route-row { grid-template-columns: minmax(100px, 1fr) 82px; }
      .bar-track { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow"><span class="mark"><span></span><span></span><span></span><span></span></span> Farm analyzer</div>
        <h1>Your production build, explained.</h1>
        <p class="subtitle">See what each emitted page loads, where client weight accumulates, and how much server code ships with the ${escapeHtml(report.preset)} preset.</p>
      </div>
      <div class="meta">
        <span class="pill">Limits use <strong>${metricLabel}</strong></span>
        <span class="pill">Preset <strong>${escapeHtml(report.preset)}</strong></span>
      </div>
    </header>

    <div class="summary">
      ${summaryCard("Emitted pages", String(report.summary.pages), "Static HTML analyzed")}
      ${summaryCard("Client JS + CSS", formatBytes(report.summary.client[metric]), `${metricLabel} total`)}
      ${summaryCard("Server JavaScript", formatBytes(report.summary.server[metric]), `${metricLabel} total`)}
      ${summaryCard(
        "Largest page",
        report.summary.largestPage ? formatBytes(report.summary.largestPage.sizes[metric]) : "None",
        report.summary.largestPage?.route ?? "No emitted HTML",
      )}
    </div>

    ${renderViolations(violations)}
    <div class="notice">
      <div class="notice-title">What page size means</div>
      <p>Each page total includes the JavaScript and CSS referenced by its emitted HTML, plus static chunk imports. Dynamic SSR pages are not guessed; use the complete client and server totals for those routes.</p>
    </div>

    <section>
      <div class="section-head">
        <div><h2>Pages</h2><p class="section-description">Initial JavaScript and CSS by emitted route.</p></div>
      </div>
      ${renderPages(report.pages, metric, largestPageSize)}
    </section>

    <section>
      <div class="section-head">
        <div><h2>Client bundles</h2><p class="section-description">JavaScript and CSS shipped to the browser.</p></div>
        <input class="search" type="search" placeholder="Filter assets" aria-label="Filter assets" data-filter>
      </div>
      ${renderAssetTable(report.clientAssets, metric, "No client JavaScript or CSS was found.")}
    </section>

    <section>
      <div class="section-head">
        <div><h2>Server bundles</h2><p class="section-description">JavaScript in the final server output.</p></div>
      </div>
      ${renderAssetTable(report.serverAssets, metric, "No server JavaScript was found.")}
    </section>

    <section>
      <div class="section-head">
        <div><h2>Other public assets</h2><p class="section-description">Images, fonts, data, and other emitted files.</p></div>
      </div>
      ${renderAssetTable(otherPublicAssets, metric, "No other public assets were found.")}
    </section>

    <div class="notice" style="margin-top:18px">
      <div class="notice-title">Analysis notes</div>
      <ul>${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </div>

    <footer>
      <span>Generated ${escapeHtml(report.generatedAt)}</span>
      <span>Output <code>${escapeHtml(report.outputDirectory)}</code></span>
    </footer>
  </main>
  <script>
    const filter = document.querySelector('[data-filter]');
    filter?.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      document.querySelectorAll('[data-asset-row]').forEach((row) => {
        row.hidden = !row.dataset.assetRow.includes(query);
      });
    });
  </script>
</body>
</html>`;
}

function renderPages(pages: AnalyzerPage[], metric: keyof AnalyzerSizes, maximum: number): string {
  if (pages.length === 0) return '<div class="empty">No emitted HTML pages were found.</div>';
  return pages
    .map(
      (page) => `<div class="route-row">
        <span class="route-name" title="${escapeHtml(page.file)}">${escapeHtml(page.route)}</span>
        <span class="bar-track"><span class="bar" style="width:${Math.max(2, (page.sizes[metric] / maximum) * 100).toFixed(2)}%"></span></span>
        <span class="route-size">${formatBytes(page.sizes[metric])}</span>
      </div>`,
    )
    .join("");
}

function renderAssetTable(
  assets: AnalyzerAsset[],
  metric: keyof AnalyzerSizes,
  emptyMessage: string,
): string {
  if (assets.length === 0) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Asset</th><th>Raw</th><th>Gzip</th><th>Brotli</th><th>Pages</th></tr></thead>
    <tbody>${assets
      .map(
        (asset) => `<tr data-asset-row="${escapeHtml(asset.path.toLowerCase())}">
          <td>${escapeHtml(asset.path)}</td>
          ${sizeCell(asset.sizes.raw, metric === "raw")}
          ${sizeCell(asset.sizes.gzip, metric === "gzip")}
          ${sizeCell(asset.sizes.brotli, metric === "brotli")}
          <td>${asset.usedByPages === undefined ? "N/A" : asset.usedByPages}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function sizeCell(value: number, primary: boolean): string {
  return `<td${primary ? ' class="primary-size"' : ""}>${formatBytes(value)}</td>`;
}

function summaryCard(label: string, value: string, note: string): string {
  return `<div class="card"><div class="card-label">${escapeHtml(label)}</div><div class="card-value">${escapeHtml(value)}</div><div class="card-note">${escapeHtml(note)}</div></div>`;
}

function renderViolations(violations: AnalyzerLimitViolation[]): string {
  if (violations.length === 0) return "";
  return `<div class="notice danger">
    <div class="notice-title">${violations.length} size ${violations.length === 1 ? "limit was" : "limits were"} exceeded</div>
    <ul>${violations
      .map(
        (violation) =>
          `<li><strong>${escapeHtml(violation.kind)}</strong> ${escapeHtml(violation.name)} is ${formatBytes(violation.actual)}; limit ${formatBytes(violation.limit)} (${escapeHtml(violation.metric)})</li>`,
      )
      .join("")}</ul>
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
