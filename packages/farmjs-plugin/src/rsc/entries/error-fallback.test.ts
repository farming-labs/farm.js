import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { generateErrorFallbackEntry } from "./error-fallback.js";
import { generateRscEntry } from "./rsc.js";

afterEach(() => vi.unstubAllGlobals());

it("creates Error and reset in client code, preserving route props", () => {
  const entry = generateErrorFallbackEntry();
  expect(entry).toMatch(/^"use client"/);
  const factory = new Function(
    "React",
    entry
      .replace("import React from 'react';", "")
      .replace("export default function", "return function"),
  )(React);
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  const Fallback = () => null;
  const element = factory({
    Fallback,
    message: "Internal Server Error",
    fallbackProps: { path: "/broken", searchParams: { tag: ["a", "b"] } },
  });
  expect(element.type).toBe(Fallback);
  expect(element.props.error).toBeInstanceOf(Error);
  expect(element.props.error.message).toBe("Internal Server Error");
  expect(element.props.searchParams).toEqual({ tag: ["a", "b"] });
  element.props.reset();
  expect(reload).toHaveBeenCalledOnce();
});

it("only exposes original error messages for the serve command", () => {
  const context = {
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "test",
    debug: false,
  };
  expect(generateRscEntry(context)).toContain("const message = false && err instanceof Error");
  expect(generateRscEntry({ ...context, development: true })).toContain(
    "const message = true && err instanceof Error",
  );
});
