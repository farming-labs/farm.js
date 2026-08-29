// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { usePathname, useSearchParams } from "../navigation";
import { useQueryState } from "../query/client";
import { asString } from "../query/parsers";
import { _runWithCurrentRequest } from "../server/request";

/**
 * A node environment on purpose. There is no `window`, so these take the same
 * path a client hook takes while the page is rendered on the server.
 */

function PathProbe() {
  return <span>{`path:${usePathname()}`}</span>;
}

function SearchProbe() {
  return <span>{`search:${useSearchParams().toString()}`}</span>;
}

function QueryProbe() {
  const [url] = useQueryState("url", asString);
  return <span>{`url:${url ?? ""}`}</span>;
}

describe("client hooks rendered on the server", () => {
  it("runs without a window", () => {
    expect(typeof window).toBe("undefined");
  });

  it("usePathname reflects the request path rather than the site root", async () => {
    await _runWithCurrentRequest(new Request("https://farmjs.dev/users/42?tab=posts"), () => {
      expect(renderToString(<PathProbe />)).toContain("path:/users/42");
    });
  });

  it("useSearchParams reflects the request query rather than an empty one", async () => {
    await _runWithCurrentRequest(new Request("https://farmjs.dev/users/42?tab=posts"), () => {
      expect(renderToString(<SearchProbe />)).toContain("search:tab=posts");
    });
  });

  it("useQueryState reads the value from the request", async () => {
    await _runWithCurrentRequest(
      new Request("https://farmjs.dev/scan?url=https%3A%2F%2Ffarmjs.dev"),
      () => {
        expect(renderToString(<QueryProbe />)).toContain("url:https://farmjs.dev");
      },
    );
  });

  it("falls back to the site root outside a request", () => {
    expect(renderToString(<PathProbe />)).toContain("path:/");
    expect(renderToString(<SearchProbe />)).toContain("search:");
  });
});
