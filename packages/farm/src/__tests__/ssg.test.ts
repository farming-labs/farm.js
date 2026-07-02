// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSSGPages, parseRouteRenderingDirective, resolveRouteRenderingConfig } from "../ssg";
import type { RouteModule } from "../types";

const tempDirs = new Set<string>();

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

describe("route rendering config", () => {
  afterEach(async () => {
    await Promise.all(
      [...tempDirs].map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
        tempDirs.delete(dir);
      }),
    );
  });

  it("keeps existing Farm SSG exports working", () => {
    expect(resolveRouteRenderingConfig({ ssg: true }).ssg).toBe(true);
    expect(resolveRouteRenderingConfig({ ssg: true, revalidate: 60 })).toMatchObject({
      ssg: true,
      revalidate: 60,
    });
  });

  it("supports Next-compatible dynamic and revalidate exports", () => {
    expect(resolveRouteRenderingConfig({ dynamic: "force-static" })).toMatchObject({
      ssg: true,
      dynamic: "force-static",
    });
    expect(resolveRouteRenderingConfig({ revalidate: 30 })).toMatchObject({
      ssg: true,
      revalidate: 30,
    });
    expect(
      resolveRouteRenderingConfig({
        ssg: true,
        revalidate: 30,
        dynamic: "force-dynamic",
      }),
    ).toMatchObject({
      ssg: false,
      dynamic: "force-dynamic",
    });
  });

  it("parses top-of-file rendering directives", () => {
    expect(
      parseRouteRenderingDirective(`
        // leading comment
        "use client";
        "use ssg; 60;";

        export default function Page() {
          return null;
        }
      `),
    ).toMatchObject({
      ssg: true,
      revalidate: 60,
      dynamic: "force-static",
    });

    expect(parseRouteRenderingDirective(`'use ssr';`)).toMatchObject({
      ssg: false,
      dynamic: "force-dynamic",
    });
  });

  it("lets explicit module exports override source directives", () => {
    expect(resolveRouteRenderingConfig({ ssg: false }, `"use ssg; 60";`)).toMatchObject({
      ssg: false,
      revalidate: undefined,
    });
  });

  it("collects static pages marked by source directives", async () => {
    const dir = await createTempDir("farm-ssg-directive-");
    const pagePath = path.join(dir, "page.tsx");
    await writeFile(
      pagePath,
      `
        "use ssg; 45";
        export default function Page() {
          return null;
        }
      `,
    );

    const result = await collectSSGPages(
      [
        {
          path: "/about",
          filePath: pagePath,
          isDynamic: false,
          pattern: "/about",
        },
      ],
      async () => ({}) as RouteModule,
    );

    expect(result.ssg).toEqual([
      {
        urlPath: "/about",
        filePath: pagePath,
        params: {},
        revalidate: 45,
      },
    ]);
    expect(result.ssr).toEqual([]);
  });
});
