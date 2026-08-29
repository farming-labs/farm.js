import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmIsolatedClientBoundary } from "../client/isolated-boundary";

describe("isolated client boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves SSR output and embeds serializable hydration props", () => {
    function Counter({ initial }: { initial: number }) {
      return <button>{initial}</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Counter,
      "/src/counter.tsx",
      "default",
      "load",
    );

    const html = renderToStaticMarkup(<Boundary initial={2} />);
    expect(html).toContain('data-farm-client-boundary="/src/counter.tsx"');
    expect(html).toContain('data-farm-client-props="{&quot;initial&quot;:2}"');
    expect(html).toContain("<button>2</button>");
  });

  it("keeps unsupported props server-rendered without emitting an unsafe marker", () => {
    function Action({ onAction }: { onAction: () => void }) {
      return <button onClick={onAction}>Run</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Action,
      "/src/action.tsx",
      "default",
      "load",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", undefined);

    const html = renderToStaticMarkup(<Boundary onAction={() => undefined} />);
    expect(html).toBe("<button>Run</button>");
    expect(html).not.toContain("farm-client-boundary");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("function values"));
  });

  it("rejects undefined values instead of changing their client semantics to null", () => {
    function Value({ value }: { value?: string }) {
      return <span>{String(value)}</span>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Value,
      "/src/value.tsx",
      "default",
      "load",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", undefined);

    const html = renderToStaticMarkup(<Boundary value={undefined} />);
    expect(html).toBe("<span>undefined</span>");
    expect(html).not.toContain("farm-client-boundary");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("undefined values"));
  });
});
