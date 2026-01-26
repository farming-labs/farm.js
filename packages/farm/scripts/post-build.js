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

/**
 * Helper function to find and copy a file matching a pattern
 */
function fixTypeFile(pattern, target, checkContent, extraExports) {
  const files = fs.readdirSync(distDir);
  const match = files.find((file) => {
    if (!pattern.test(file)) return false;
    if (checkContent) {
      const content = fs.readFileSync(path.join(distDir, file), "utf8");
      return content.includes(checkContent);
    }
    return true;
  });

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

  // Fix query/index.d.mts
  const indexMatch = queryFiles.find((file) => /^index-.*\.d\.mts$/.test(file));
  if (indexMatch) {
    let content = fs.readFileSync(path.join(queryDir, indexMatch), "utf8");
    content = content.replace(
      /export \{ [^}]+ \};[\s\S]*$/,
      "\nexport type { PagePropsSafe, LayoutPropsSafe, QueryStateConfig, FarmQueryStateContext, QueryStateProvider };\nexport { parseAsString, parseAsInteger, parseAsFloat, parseAsBoolean, parseAsArrayOf, parseAsJson, parseAsIsoDate, parseAsIsoDateTime, createParser, type Parser, type inferParserType };",
    );
    fs.writeFileSync(path.join(queryDir, "index.d.mts"), content);
  }

  // Fix query/client.d.mts
  // Use the same approach as server.d.mts - import from root parsers file
  const clientMatch = queryFiles.find((file) => /^client-.*\.d\.mts$/.test(file));
  if (clientMatch) {
    let content = fs.readFileSync(path.join(queryDir, clientMatch), "utf8");
    // Find the root parsers file to import from (same as server does)
    const rootParsersMatch = fs
      .readdirSync(distDir)
      .find((file) => /^parsers-.*\.d\.mts$/.test(file));
    if (rootParsersMatch) {
      // Replace import to use root parsers file (like server does)
      // This ensures type resolution works the same way as server module
      const rootParsersPath = `../${rootParsersMatch.replace(".d.mts", ".mjs")}`;
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

  // Fix query/server.d.mts
  const serverMatch = queryFiles.find((file) => /^server-.*\.d\.mts$/.test(file));
  if (serverMatch) {
    const content = fs.readFileSync(path.join(queryDir, serverMatch), "utf8");
    fs.writeFileSync(path.join(queryDir, "server.d.mts"), content);
  }

  // Fix query/parsers.d.mts
  // Extract type definitions from root parsers file to avoid broken imports
  // This ensures TypeScript can properly infer types for asString, useQueryState, etc.
  const rootParsersMatch = fs
    .readdirSync(distDir)
    .find((file) => /^parsers-.*\.d\.mts$/.test(file));
  if (rootParsersMatch) {
    const rootContent = fs.readFileSync(path.join(distDir, rootParsersMatch), "utf8");
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

// Fix main dist files
fixTypeFile(/^index-.*\.d\.mts$/, "index.d.mts", "loadConfig");
fixTypeFile(
  /^client-.*\.d\.mts$/,
  "client.d.mts",
  "declare function createAPIClient",
  "export { createAPIClient, createServerAPIClient };\nexport type { APIClientOptions };",
);
fixTypeFile(/^server-.*\.d\.mts$/, "server.d.mts");
fixTypeFile(/^vite-.*\.d\.mts$/, "vite.d.mts");
fixTypeFile(
  /^plugin-.*\.d\.mts$/,
  "plugin.d.mts",
  "interface FarmPlugin",
  "export type { FarmPlugin, FarmPluginContext };\nexport { PluginManager, definePlugin };",
);
fixTypeFile(/^server-plugins-.*\.d\.mts$/, "server-plugins.d.mts");
fixTypeFile(/^client-plugins-.*\.d\.mts$/, "client-plugins.d.mts");
fixTypeFile(/^middleware-.*\.d\.mts$/, "middleware.d.mts");

// Fix query directory files
fixQueryFiles();

console.log("✅ Post-build type definitions fixed");
