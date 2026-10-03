/**
 * Generate the default app from packed tarballs and prove it works as a user
 * would get it: install, type-check, build with the template's own target,
 * then build and serve a Node production server.
 *
 * Workspace links hide missing files in the published tarballs, templates that
 * pin versions the release does not publish, and generator code that only
 * works from source. Nothing here contacts npm for @farm.js packages.
 */
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { readPublicPackages } = require("./public-packages");

const repositoryRoot = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const template = "basic";

function packPackage(pkg, archiveDirectory) {
  const before = new Set(fs.readdirSync(archiveDirectory));
  execFileSync(pnpm, ["pack", "--pack-destination", archiveDirectory], {
    cwd: pkg.dir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const archives = fs
    .readdirSync(archiveDirectory)
    .filter((file) => file.endsWith(".tgz") && !before.has(file));
  if (archives.length !== 1) {
    throw new Error(`Packing ${pkg.name} produced ${archives.length} archives; expected one.`);
  }
  return path.join(archiveDirectory, archives[0]);
}

function fileSpecifier(filePath) {
  return `file:${filePath.replaceAll(path.sep, "/")}`;
}

/** Every workspace package reachable from `names` through runtime dependencies. */
function collectFarmPackages(names, publicPackages) {
  const seen = new Set();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name) || !publicPackages.has(name)) continue;
    seen.add(name);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(publicPackages.get(name).dir, "package.json"), "utf8"),
    );
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const dependency of Object.keys(manifest[field] || {})) {
        if (publicPackages.has(dependency)) queue.push(dependency);
      }
    }
  }
  return [...seen].sort();
}

/** Point every packed @farm.js package at its tarball, including transitive uses. */
function pinToArchives(manifest, archives) {
  const next = structuredClone(manifest);
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(next[field] || {})) {
      if (archives.has(name)) next[field][name] = fileSpecifier(archives.get(name));
    }
  }
  next.pnpm = {
    ...next.pnpm,
    overrides: {
      ...next.pnpm?.overrides,
      ...Object.fromEntries([...archives].map(([name, archive]) => [name, fileSpecifier(archive)])),
    },
  };
  return next;
}

function findServerEntry(appDirectory) {
  for (const candidate of [".output/server/index.mjs", ".farm/.output/server/index.mjs"]) {
    const entry = path.join(appDirectory, candidate);
    if (fs.existsSync(entry)) return entry;
  }
  throw new Error("The node-server build did not produce a server/index.mjs entry.");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForResponse(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The production server exited with code ${child.exitCode}.`);
    }
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`The production server did not answer ${url}.`, { cause: lastError });
}

async function serveAndCheck(appDirectory) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [findServerEntry(appDirectory)], {
    cwd: appDirectory,
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    const response = await waitForResponse(`${origin}/`, child);
    const html = await response.text();
    if (response.status !== 200) {
      throw new Error(`GET / returned ${response.status}.`);
    }
    if (!/<div id="root"/.test(html)) {
      throw new Error("GET / did not return a Farm document with a hydration root.");
    }

    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    const moduleScript = scripts.find((src) => src.startsWith("/"));
    if (!moduleScript) throw new Error("GET / did not reference a client entry script.");
    const asset = await fetch(new URL(moduleScript, origin));
    if (asset.status !== 200) {
      throw new Error(`The client entry ${moduleScript} returned ${asset.status}.`);
    }
    console.log(`Served / and ${moduleScript} from the packed app on port ${port}.`);
  } finally {
    child.kill("SIGTERM");
  }
}

async function runSmoke() {
  const publicPackages = new Map(readPublicPackages(repositoryRoot).map((pkg) => [pkg.name, pkg]));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-packed-app-smoke-"));
  const archiveDirectory = path.join(temporaryRoot, "archives");
  const runnerDirectory = path.join(temporaryRoot, "runner");
  const appDirectory = path.join(temporaryRoot, "farm-smoke-app");
  fs.mkdirSync(archiveDirectory);
  fs.mkdirSync(runnerDirectory);

  try {
    const createApp = publicPackages.get("@farm.js/create-app");
    console.log(`Packing @farm.js/create-app@${createApp.version}...`);
    const generatorArchive = packPackage(createApp, archiveDirectory);
    fs.writeFileSync(
      path.join(runnerDirectory, "package.json"),
      `${JSON.stringify(
        {
          name: "farm-packed-app-runner",
          private: true,
          dependencies: { "@farm.js/create-app": fileSpecifier(generatorArchive) },
        },
        null,
        2,
      )}\n`,
    );
    execFileSync(pnpm, ["install", "--ignore-scripts", "--no-frozen-lockfile"], {
      cwd: runnerDirectory,
      stdio: "inherit",
    });

    console.log(`Generating the ${template} template from the packed generator...`);
    execFileSync(
      process.execPath,
      [
        path.join(
          runnerDirectory,
          "node_modules",
          "@farm.js",
          "create-app",
          "bin",
          "create-farm-app.js",
        ),
        path.basename(appDirectory),
        "--template",
        template,
        "--typescript",
        "--skip-install",
      ],
      {
        cwd: temporaryRoot,
        stdio: "inherit",
        env: { ...process.env, npm_config_user_agent: "pnpm/8.12.1 npm/? node/v22.13.0" },
      },
    );

    const manifestPath = path.join(appDirectory, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    const unpublished = declared.filter(
      (name) => name.startsWith("@farm.js/") && !publicPackages.has(name),
    );
    if (unpublished.length > 0) {
      throw new Error(`The template depends on non-workspace packages: ${unpublished.join(", ")}.`);
    }
    for (const name of declared.filter((dependency) => publicPackages.has(dependency))) {
      const range = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
      const version = publicPackages.get(name).version;
      if (range !== version) {
        throw new Error(
          `The template pins ${name}@${range}, but the workspace releases ${version}.`,
        );
      }
    }

    const archives = new Map([["@farm.js/create-app", generatorArchive]]);
    for (const name of collectFarmPackages(declared, publicPackages)) {
      if (archives.has(name)) continue;
      console.log(`Packing ${name}@${publicPackages.get(name).version}...`);
      archives.set(name, packPackage(publicPackages.get(name), archiveDirectory));
    }
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(pinToArchives(manifest, archives), null, 2)}\n`,
    );

    console.log("Installing the generated app from packed artifacts...");
    execFileSync(pnpm, ["install", "--no-frozen-lockfile"], {
      cwd: appDirectory,
      stdio: "inherit",
    });

    console.log("Type-checking the generated app...");
    execFileSync(pnpm, ["run", "type-check"], { cwd: appDirectory, stdio: "inherit" });

    console.log("Building with the template's configured target...");
    execFileSync(pnpm, ["run", "build"], { cwd: appDirectory, stdio: "inherit" });

    console.log("Building and serving a Node production server...");
    execFileSync(pnpm, ["exec", "farm", "build", "--preset", "node-server"], {
      cwd: appDirectory,
      stdio: "inherit",
    });
    await serveAndCheck(appDirectory);

    console.log(`Packed ${template} app smoke passed (${archives.size} Farm packages).`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runSmoke().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { collectFarmPackages, pinToArchives, runSmoke };
