#!/usr/bin/env node

/**
 * Post-build script to fix type definition files
 * This script renames hashed type definition files to their expected names
 * and fixes import paths and exports
 */

const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const queryDir = path.join(distDir, "query");

if (!fs.existsSync(distDir)) {
  console.warn("⚠️ dist/ not found; run tsdown first. Skipping post-build.");
  process.exit(0);
}

/**
 * Helper function to find and copy a file matching a pattern (hashed or clean name)
 */
function fixTypeFile(pattern, target, checkContent, extraExports) {
  const files = fs.readdirSync(distDir);
  let match = files.find((file) => {
    if (!pattern.test(file)) return false;
    if (checkContent) {
      const content = fs.readFileSync(path.join(distDir, file), "utf8");
      return content.includes(checkContent);
    }
    return true;
  });
  if (!match && files.includes(target)) {
    match = target;
  }

  if (match) {
    let content = fs.readFileSync(path.join(distDir, match), "utf8");
    if (extraExports) {
      content = content.replace(/export \{ [^}]+ \};[\s\S]*$/, "\n" + extraExports);
    }
    fs.writeFileSync(path.join(distDir, target), content);
  }
}

/**
 * Fix query directory type files
 */
function fixQueryFiles() {
  if (!fs.existsSync(queryDir)) {
    return;
  }

  const queryFiles = fs.readdirSync(queryDir);

  const indexMatch =
    queryFiles.find((file) => /^index-.*\.d\.mts$/.test(file)) ||
    (queryFiles.includes("index.d.mts") ? "index.d.mts" : null);
  if (indexMatch) {
    let content = fs.readFileSync(path.join(queryDir, indexMatch), "utf8");
    content = content.replace(
      /export \{ [^}]+ \};[\s\S]*$/,
      "\nexport type { PagePropsSafe, LayoutPropsSafe, QueryStateConfig, FarmQueryStateContext, QueryStateProvider };\nexport { parseAsString, parseAsInteger, parseAsFloat, parseAsBoolean, parseAsArrayOf, parseAsJson, parseAsIsoDate, parseAsIsoDateTime, createParser, type Parser, type inferParserType };",
    );
    fs.writeFileSync(path.join(queryDir, "index.d.mts"), content);
  }

  const clientMatch =
    queryFiles.find((file) => /^client-.*\.d\.mts$/.test(file)) ||
    (queryFiles.includes("client.d.mts") ? "client.d.mts" : null);
  if (clientMatch) {
    let content = fs.readFileSync(path.join(queryDir, clientMatch), "utf8");
    const rootParsersMatch = queryFiles.find((file) => /^parsers-.*\.d\.mts$/.test(file));
    if (rootParsersMatch) {
      const rootParsersPath = `./${rootParsersMatch.replace(".d.mts", ".mjs")}`;
      content = content.replace(/from ["']\.\/parsers["']/g, `from "${rootParsersPath}"`);
      content = content.replace(/from ["']\.\.\/parsers-[^"']+["']/g, `from "${rootParsersPath}"`);
      // Remove any explicit declarations we added before - let TypeScript resolve from imports
      content = content.replace(
        /\/\/ Explicit parser type declarations for proper type inference[\s\S]*?declare function createParser[^;]+;\n\n/g,
        "",
      );
    }
    fs.writeFileSync(path.join(queryDir, "client.d.mts"), content);
  }

  const serverMatch =
    queryFiles.find((file) => /^server-.*\.d\.mts$/.test(file)) ||
    (queryFiles.includes("server.d.mts") ? "server.d.mts" : null);
  if (serverMatch) {
    const content = fs.readFileSync(path.join(queryDir, serverMatch), "utf8");
    fs.writeFileSync(path.join(queryDir, "server.d.mts"), content);
  }

  const rootParsersMatch = queryFiles.find((file) => /^parsers-.*\.d\.mts$/.test(file));
  if (rootParsersMatch) {
    const rootContent = fs.readFileSync(path.join(queryDir, rootParsersMatch), "utf8");
    // Extract the type definitions (the //#region section)
    const regionMatch = rootContent.match(/\/\/#region[\s\S]*?\/\/#endregion/);
    if (regionMatch) {
      // Create clean parsers.d.mts with type declarations and proper exports
      const typeDefs = regionMatch[0];
      const cleanContent =
        typeDefs +
        "\n\nexport { Parser, asString, asInteger, asFloat, asBoolean, asArrayOf, asJson, asIsoDate, asIsoDateTime, createParser, inferParserType };";
      fs.writeFileSync(path.join(queryDir, "parsers.d.mts"), cleanContent);
    }
  }
}

const requiredTargets = [
  "index.d.mts",
  "client.d.mts",
  "server.d.mts",
  "vite.d.mts",
  "plugin.d.mts",
  "server-plugins.d.mts",
  "client-plugins.d.mts",
  "middleware.d.mts",
  "api.d.mts",
];

fixTypeFile(/^index-.*\.d\.mts$/, "index.d.mts", "loadConfig");
fixTypeFile(
  /^client-.*\.d\.mts$/,
  "client.d.mts",
  "createAPIClient",
  "export { createAPIClient, createServerAPIClient };\nexport type { APIClientOptions };",
);
fixTypeFile(/^server-.*\.d\.mts$/, "server.d.mts");
fixTypeFile(/^vite-.*\.d\.mts$/, "vite.d.mts");
fixTypeFile(
  /^plugin-.*\.d\.mts$/,
  "plugin.d.mts",
  "FarmPlugin",
  "export type { FarmPlugin, FarmPluginContext };\nexport { PluginManager, definePlugin };",
);
fixTypeFile(/^server-plugins-.*\.d\.mts$/, "server-plugins.d.mts");
fixTypeFile(/^client-plugins-.*\.d\.mts$/, "client-plugins.d.mts");
fixTypeFile(
  /^middleware-.*\.d\.mts$/,
  "middleware.d.mts",
  "MiddlewareContext",
  "export { middleware, getRateLimitStatus, memoryRateLimitStorage, UnsupportedRateLimitStorageError, createContext, MiddlewareManager, getMiddlewareData, getMiddlewareValue, unwrapMiddleware, getFromMiddleware, hasMiddlewareData };\nexport type { MiddlewareContext, MiddlewareFunction, MiddlewareChain, MiddlewareConfig, CookieJar, CookieOptions, RateLimitConfig, RateLimitIncrementResult, RateLimitStorage, RateLimitStatus, MemoryRateLimitStorageOptions, NextFunction };",
);
fixTypeFile(/^api-.*\.d\.mts$/, "api.d.mts");

fixQueryFiles();

const missing = requiredTargets.filter((t) => !fs.existsSync(path.join(distDir, t)));
if (missing.length > 0) {
  console.error("❌ Post-build failed: missing type files after fix:", missing.join(", "));
  console.error("   Ensure tsdown produced .d.mts files in dist/ (hashed or clean names).");
  process.exit(1);
}
console.log("✅ Post-build type definitions fixed");
