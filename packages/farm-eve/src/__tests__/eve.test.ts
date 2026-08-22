import { access, readFile, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { assertEveNodeVersion, eve, findEveServerOrigin } from "../index";
import { writeEveVercelOutput } from "../vercel";

describe("eve integration", () => {
  it("mounts the Eve API and workflow callback routes", () => {
    const integration = eve({ dev: false, vercel: false });

    expect(integration.category).toBe("agent");
    expect(integration.type).toBe("eve");
    expect(integration.instance).toMatchObject({
      provider: "eve",
      routePrefix: "/eve",
      routePrefixes: ["/eve", "/.well-known/workflow"],
    });
    expect(integration.routes?.map((route) => route.path)).toEqual([
      "/eve/[...farmAgentRuntimePath]",
      "/.well-known/workflow/[...farmAgentRuntimePath]",
    ]);
  });

  it("parses the listening URL and reports an actionable Node requirement", () => {
    expect(findEveServerOrigin("\u001b[32mLocal:\u001b[0m http://127.0.0.1:4274\n")).toBe(
      "http://127.0.0.1:4274",
    );
    expect(findEveServerOrigin("remote https://agent.example.com:443")).toBeUndefined();
    expect(() => assertEveNodeVersion("23.11.0")).toThrow("Node.js 24 or newer");
    expect(() => assertEveNodeVersion("24.0.0")).not.toThrow();
  });
});

describe("Eve Vercel output", () => {
  it("composes the real Eve service into Farm's Vercel output", async () => {
    assertEveNodeVersion();
    const workspaceRoot = await mkdtemp(join(tmpdir(), "farm-eve-vercel-"));
    const root = join(workspaceRoot, "apps", "web");
    const outputDirectory = join(root, ".vercel", "output");
    const packageDirectory = dirname(createRequire(import.meta.url).resolve("eve/package.json"));
    await mkdir(join(root, "agent"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await mkdir(join(workspaceRoot, ".vercel"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(workspaceRoot, ".vercel", "project.json"), "{}\n");
    await writeFile(join(outputDirectory, "config.json"), '{"version":3,"routes":[]}\n');
    // Junctions need no Windows privilege; the type is ignored on POSIX.
    await symlink(packageDirectory, join(root, "node_modules", "eve"), "junction");

    await writeEveVercelOutput({
      root,
      agentRoot: "agent",
    });

    const config = JSON.parse(await readFile(join(outputDirectory, "config.json"), "utf8"));
    expect(config.services.eve).toMatchObject({
      framework: "eve",
      routes: [
        expect.objectContaining({
          src: "^/eve/v1/(.*)$",
        }),
      ],
    });
    expect(config.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: { type: "service", service: "eve" },
        }),
      ]),
    );
    await expect(access(join(root, ".vercel", "project.json"))).rejects.toThrow();
    await expect(access(join(workspaceRoot, ".vercel", "output"))).rejects.toThrow();
  });
});
