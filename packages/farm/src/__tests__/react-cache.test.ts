import { describe, expect, it, vi } from "vitest";
import { rewriteFarmReactCacheImport } from "../islands-react-cache-transform";
import { cache, cacheSignal } from "../react-cache";
import { _runWithAfterRequest } from "../after";
import { _runWithCurrentRequest } from "../server/request";

const request = (path: string) => new Request(`http://localhost${path}`);

describe("cache in islands mode", () => {
  it("runs a function once per request and arguments, as React Server Components do", async () => {
    const load = vi.fn((id: number, options?: object) => ({ id, options }));
    const getUser = cache(load);
    const options = {};
    const first = await _runWithCurrentRequest(request("/a"), () => {
      const user = getUser(1);
      expect(getUser(1)).toBe(user);
      expect(getUser(2)).not.toBe(user);
      expect(getUser(1, options)).toBe(getUser(1, options));
      expect(getUser(1, {})).not.toBe(getUser(1, options));
      return user;
    });
    expect(load).toHaveBeenCalledTimes(4);
    // Another request gets its own results.
    const second = await _runWithCurrentRequest(request("/b"), () => getUser(1));
    expect(second).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("keeps each cache() call apart, remembers a throw, and calls through outside a request", async () => {
    const fn = vi.fn((value: string) => {
      if (value === "bad") throw new Error("bad input");
      return { value };
    });
    const left = cache(fn);
    const right = cache(fn);
    await _runWithCurrentRequest(request("/"), () => {
      expect(left("x")).not.toBe(right("x"));
      expect(() => left("bad")).toThrow("bad input");
      expect(() => left("bad")).toThrow("bad input");
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(left("y")).not.toBe(left("y"));
  });

  it("points a server module's cache import at Farm's, keeping its other react imports", () => {
    const output = rewriteFarmReactCacheImport(
      'import React, { cache as memo, useId } from "react";\nexport const load = memo(() => 1);\n',
      "/app/src/data.ts",
    )!;
    expect(output).toContain('import React, { useId } from "react";');
    expect(output).toContain('import { cache as memo } from "@farm.js/core/internal/react-cache";');
    expect(
      rewriteFarmReactCacheImport('import { useState } from "react";\n', "/app/a.ts"),
    ).toBeNull();
    expect(
      rewriteFarmReactCacheImport('import type { cache } from "react";\n', "/app/a.ts"),
    ).toBeNull();
    // React.cache through a default or namespace import.
    for (const clause of ["React", "* as React"]) {
      const member = rewriteFarmReactCacheImport(
        `import ${clause} from "react";\nexport const load = React.cache(() => 1);\nexport const memo = React.memo;\n`,
        "/app/src/data.ts",
      )!;
      expect(member).toContain("export const load = __farm_react_cache__(() => 1);");
      expect(member).toContain("export const memo = React.memo;");
      expect(member).toContain(
        'import { cache as __farm_react_cache__ } from "@farm.js/core/internal/react-cache";',
      );
    }
  });

  it("gives each request a cacheSignal that aborts once its response has finished", async () => {
    expect(cacheSignal()).toBeNull();
    let signal: AbortSignal | null = null;
    const req = request("/signal");
    const response = await _runWithAfterRequest(req, () =>
      _runWithCurrentRequest(req, async () => {
        signal = cacheSignal();
        expect(cacheSignal()).toBe(signal);
        return new Response("done");
      }),
    );
    // Open while the response streams; aborted once it has been read to the end.
    expect(signal!.aborted).toBe(false);
    expect(await response.text()).toBe("done");
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
  });

  it("points cacheSignal at Farm's, and leaves other React members alone", () => {
    const output = rewriteFarmReactCacheImport(
      'import React, { cacheSignal } from "react";\nexport const s = () => [cacheSignal(), React.cacheSignal(), React.toString()];\n',
      "/app/src/data.ts",
    )!;
    expect(output).toContain(
      'import { cacheSignal as cacheSignal } from "@farm.js/core/internal/react-cache";',
    );
    expect(output).toContain("__farm_react_cache_signal__()");
    expect(output).toContain("React.toString()");
  });
});
