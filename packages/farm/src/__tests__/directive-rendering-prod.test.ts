// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeRouteRenderingDirectiveConfig } from "../route-rendering";
import { parseRouteRenderingDirective, resolveRouteRenderingConfig } from "../ssg";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(__dirname, "..", ...segments), "utf8");
}

describe("shared route-rendering merge", () => {
  it("matches the development resolver for every directive and export combination", () => {
    const sources = [
      undefined,
      '"use ssg";\nexport default function Page() {}',
      '"use ssg; 60";\nexport default function Page() {}',
      '"use isr: 120";\nexport default function Page() {}',
      '"use ssr";\nexport default function Page() {}',
      '"use ppr";\nexport default function Page() {}',
    ];
    const modules = [
      null,
      {},
      { ssg: true },
      { ssg: false },
      { revalidate: 30 },
      { revalidate: 0 },
      { dynamic: "force-dynamic" },
      { dynamic: "force-static" },
      { ppr: true },
    ];

    for (const experimentalPPR of [false, true]) {
      for (const source of sources) {
        for (const mod of modules) {
          const options = { experimentalPPR };
          expect(
            mergeRouteRenderingDirectiveConfig(
              parseRouteRenderingDirective(source),
              mod as never,
              options,
            ),
            `source=${JSON.stringify(source)} mod=${JSON.stringify(mod)} ppr=${experimentalPPR}`,
          ).toEqual(resolveRouteRenderingConfig(mod as never, source, options));
        }
      }
    }
  });

  it("gives a directive-only ISR route its cache lifetime", () => {
    const view = mergeRouteRenderingDirectiveConfig(
      parseRouteRenderingDirective('"use ssg; 60";\nexport default function Page() {}'),
      {},
    );
    expect(view).toMatchObject({ ssg: true, revalidate: 60 });
  });
});

describe("production entry rendering contract", () => {
  const source = readSource("nitro", "universal-build.ts");

  it("bakes the parsed directive into page registrations", () => {
    // Directives are parsed from source at build time; production output
    // cannot read route files, so the registration must carry the config or
    // a "use ssg; 60" route silently serves private, no-store.
    expect(source).toContain("parseRouteRenderingDirectiveFromDisk(route.modulePath)");
    expect(source).toContain("rendering: ${JSON.stringify(renderingDirective)}");
  });

  it("resolves cache headers through the shared merge, not raw exports", () => {
    expect(source).toContain("mergeRouteRenderingDirectiveConfig,");
    expect(source).toContain("function resolveRouteRenderingView(route)");
    expect(source).toContain("const pprConfig = resolvePPRConfig(route);");
    expect(source).toContain("getRouteSharedCacheControl(route, pprCanCache)");
    expect(source).not.toContain("getRouteSharedCacheControl(routeModule, pprCanCache)");
  });
});
