import { describe, expect, it } from "vitest";
import { _hasPrivateFarmRequestHeaders } from "../middleware/production-runtime";
import {
  mergeRouteRenderingDirectiveConfig,
  resolveRouteSharedCacheControl,
} from "../route-rendering";

// The page cache policy core's production server and the RSC server share
// (@farm.js/plugin/rsc imports both helpers), so the same route config and
// request get the same Cache-Control from either.

describe("resolveRouteSharedCacheControl", () => {
  const policy = (mod: Record<string, unknown>, pprCanCache?: boolean) =>
    resolveRouteSharedCacheControl(
      mergeRouteRenderingDirectiveConfig(undefined, mod as never),
      pprCanCache,
    );

  it("gives static and revalidating pages a shared policy", () => {
    expect(policy({ revalidate: 300 })).toBe("public, s-maxage=300, stale-while-revalidate=300");
    expect(policy({ dynamic: "force-static" })).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(policy({}, true)).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  it("keeps dynamic pages per request", () => {
    expect(policy({})).toBeNull();
    expect(policy({ revalidate: 0 })).toBeNull();
    expect(policy({ revalidate: 300, dynamic: "force-dynamic" })).toBeNull();
    expect(policy({ dynamic: "force-dynamic" }, true)).toBeNull();
  });
});

describe("_hasPrivateFarmRequestHeaders", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://app.test/", { headers });
  const locale = { name: "FARM_LOCALE", locales: ["en", "fr"] };

  it("treats credentials and a visitor's cookies as private", () => {
    expect(_hasPrivateFarmRequestHeaders(request({ authorization: "Bearer t" }))).toBe(true);
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "session=a" }))).toBe(true);
    expect(
      _hasPrivateFarmRequestHeaders(request({ cookie: "__farm_deployment=r1; session=a" })),
    ).toBe(true);
  });

  it("keeps a request with only the deployment cookie shareable", () => {
    expect(_hasPrivateFarmRequestHeaders(request({}))).toBe(false);
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "__farm_deployment=r1" }))).toBe(false);
  });

  it("keeps a lone valid locale cookie shareable only when asked", () => {
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "FARM_LOCALE=fr" }), locale)).toBe(
      false,
    );
    expect(
      _hasPrivateFarmRequestHeaders(
        request({ cookie: "FARM_LOCALE=fr; __farm_deployment=r1" }),
        locale,
      ),
    ).toBe(false);
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "FARM_LOCALE=fr" }))).toBe(true);
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "FARM_LOCALE=de" }), locale)).toBe(true);
    expect(
      _hasPrivateFarmRequestHeaders(request({ cookie: "FARM_LOCALE=fr; session=a" }), locale),
    ).toBe(true);
    expect(_hasPrivateFarmRequestHeaders(request({ cookie: "FARM_LOCALE=%E0" }), locale)).toBe(
      true,
    );
  });
});
