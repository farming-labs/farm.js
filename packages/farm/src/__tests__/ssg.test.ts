// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("supports PPR and Next-compatible experimental_ppr without forcing SSG", () => {
    expect(resolveRouteRenderingConfig({ experimental_ppr: true, revalidate: 60 })).toMatchObject({
      ssg: false,
      ppr: true,
      revalidate: 60,
    });
    expect(resolveRouteRenderingConfig({ ppr: true })).toMatchObject({
      ssg: false,
      ppr: true,
    });
    expect(resolveRouteRenderingConfig({ ppr: true, dynamic: "force-dynamic" })).toMatchObject({
      ssg: false,
      ppr: false,
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
      ppr: false,
      dynamic: "force-dynamic",
    });

    expect(parseRouteRenderingDirective(`"use ppr; 30";`)).toMatchObject({
      ssg: false,
      ppr: true,
      revalidate: 30,
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

describe("dynamic SSG path materialization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const route = (pathPattern: string, filePath = `/virtual${pathPattern}/page.tsx`) => ({
    path: pathPattern,
    filePath,
    isDynamic: true,
    pattern: pathPattern,
  });

  it("removes an empty optional catch-all segment and populates non-empty segments", async () => {
    const result = await collectSSGPages([route("/docs/[[...slug]]")], async () => ({
      ssg: true,
      getStaticPaths: () => [{ slug: [] }, { slug: ["guides", "farm js", "café"] }],
    }));

    expect(result).toEqual({
      ssg: [
        {
          urlPath: "/docs",
          filePath: "/virtual/docs/[[...slug]]/page.tsx",
          params: { slug: "" },
          revalidate: undefined,
        },
        {
          urlPath: "/docs/guides/farm%20js/caf%C3%A9",
          filePath: "/virtual/docs/[[...slug]]/page.tsx",
          params: { slug: "guides/farm js/café" },
          revalidate: undefined,
        },
      ],
      ssr: [],
    });
  });

  it("materializes a required catch-all array as individually encoded segments", async () => {
    const result = await collectSSGPages([route("/manual/[...parts]")], async () => ({
      ssg: true,
      getStaticPaths: () => [{ parts: ["api", "routing & links", "v2"] }],
    }));

    expect(result.ssg[0]).toMatchObject({
      urlPath: "/manual/api/routing%20%26%20links/v2",
      params: { parts: "api/routing & links/v2" },
    });
    expect(result.ssr).toEqual([]);
  });

  it("encodes scalar values without allowing slashes to create path segments", async () => {
    const result = await collectSSGPages([route("/users/[id]/[label]")], async () => ({
      ssg: true,
      getStaticPaths: () => [{ id: "team/admin", label: "farm! (β)" }],
    }));

    expect(result.ssg[0]?.urlPath).toBe("/users/team%2Fadmin/farm%21%20%28%CE%B2%29");
  });

  it("treats a scalar catch-all value as one encoded segment", async () => {
    const result = await collectSSGPages([route("/files/[...path]")], async () => ({
      ssg: true,
      getStaticPaths: () => [{ path: "folder/file name" }],
    }));

    expect(result.ssg[0]?.urlPath).toBe("/files/folder%2Ffile%20name");
  });

  it("keeps dot-only scalar and catch-all segments out of SSG output", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scalarFile = "/virtual/users/[id]/page.tsx";
    const catchAllFile = "/virtual/docs/[...slug]/page.tsx";

    const result = await collectSSGPages(
      [route("/users/[id]", scalarFile), route("/docs/[...slug]", catchAllFile)],
      async (filePath) => ({
        ssg: true,
        getStaticPaths:
          filePath === scalarFile
            ? () => [{ id: "safe" }, { id: ".." }]
            : () => [{ slug: ["guide", "."] }],
      }),
    );

    expect(result).toEqual({
      ssg: [],
      ssr: ["/users/[id]", "/docs/[...slug]"],
    });
    expect(error.mock.calls.flat().map(String).join("\n")).toContain(
      "dot-only segments are unsafe to prerender",
    );
  });

  it("rejects missing scalar and empty required catch-all params without partial SSG output", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scalarFile = "/virtual/products/[id]/page.tsx";
    const catchAllFile = "/virtual/docs/[...slug]/page.tsx";

    const result = await collectSSGPages(
      [route("/products/[id]", scalarFile), route("/docs/[...slug]", catchAllFile)],
      async (filePath) => ({
        ssg: true,
        getStaticPaths:
          filePath === scalarFile ? () => [{ id: "valid" }, {}] : () => [{ slug: [] }],
      }),
    );

    expect(result).toEqual({
      ssg: [],
      ssr: ["/products/[id]", "/docs/[...slug]"],
    });
    const messages = error.mock.calls.flat().map(String).join("\n");
    expect(messages).toContain('required parameter "id" is missing or empty');
    expect(messages).toContain('required parameter "slug" is missing or empty');
  });
});
