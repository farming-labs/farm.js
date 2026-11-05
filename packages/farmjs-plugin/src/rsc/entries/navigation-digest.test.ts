import { describe, expect, it, vi } from "vitest";
import {
  getFarmRedirectError,
  isFarmNotFoundError,
} from "@farm.js/core/internal/production-runtime";
import { notFound, redirect } from "@farm.js/core/navigation";
import { generateRscEntry } from "./rsc.js";
import type { EntryContext } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "navigation-digest-test",
  debug: false,
};

function loadOnError(entry: string) {
  const start = entry.indexOf("function farmRscOnError(error) {");
  const end = entry.indexOf("\n}\n", start) + 2;
  return new Function(
    "getFarmRedirectError",
    "isFarmNotFoundError",
    "console",
    `${entry.slice(start, end)}\nreturn farmRscOnError;`,
  );
}

function thrown(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("notFound() and redirect() in an RSC render", () => {
  it("passes every page render's errors through the digest handler", () => {
    const entry = generateRscEntry(context);
    expect(entry).toContain(
      "renderToReadableStream(payload, { onError: farmRscOnError, temporaryReferences })",
    );
    expect(entry).toContain("renderToReadableStream(payload, { onError: farmRscOnError })");
    expect(generateRscEntry({ ...context, actionsEnabled: false })).toContain(
      "renderToReadableStream(payload, { onError: farmRscOnError })",
    );
  });

  it("keeps their digests, so the handler answers 404 or the redirect", () => {
    const log = { error: vi.fn() };
    const onError = loadOnError(generateRscEntry(context))(
      getFarmRedirectError,
      isFarmNotFoundError,
      log,
    );

    expect(onError(thrown(() => notFound()))).toBe("FARM_NOT_FOUND");
    expect(onError(thrown(() => redirect("/next/target")))).toBe("FARM_REDIRECT;307;/next/target");
    expect(log.error).not.toHaveBeenCalled();

    const failure = new Error("page failed");
    expect(onError(failure)).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(failure);
  });
});
