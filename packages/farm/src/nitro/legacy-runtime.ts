const FARM_LEGACY_ERROR_HTML =
  "<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Error</h1><p>Internal Server Error</p></body></html>";

export function serializeFarmInlineValue(value: unknown): string {
  return (JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeFarmHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderFarmLegacyHtml(options: {
  deploymentId: unknown;
  pageProps: unknown;
  pathname: unknown;
  html: string;
  clientScript: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Farm.js App</title>
  <script>
    window.__FARM_DEPLOYMENT_ID__ = ${serializeFarmInlineValue(options.deploymentId)};
    window.__FARM_PROPS__ = ${serializeFarmInlineValue(options.pageProps)};
    window.__FARM_PATH__ = ${serializeFarmInlineValue(options.pathname)};
  </script>
</head>
<body>
  <div id="root">${options.html}</div>
  <script type="module" src="${escapeFarmHtmlAttribute(options.clientScript)}"></script>
</body>
</html>`;
}

export function renderFarmLegacyErrorHtml(): string {
  return FARM_LEGACY_ERROR_HTML;
}
