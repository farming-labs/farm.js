// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SERVER_TREES = "../client/islands-server-tree";

// islx's server trees and the reviving code they import load with a page's first server tree, so a
// page of islands only never loads them (RFC 0013).
describe("islands mode's server trees", () => {
  const createServerTreeElement = vi.fn(async () => "page");
  const createServerTreeLayout = vi.fn(async () => "layout");
  const options = { load: vi.fn(), ServerHtml: () => null };
  let imports = 0;
  let failures = 0;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    imports = 0;
    failures = 0;
    vi.doMock(SERVER_TREES, () => {
      imports++;
      if (failures > 0) {
        failures--;
        throw new Error("chunk failed to load");
      }
      return { createServerTreeElement, createServerTreeLayout };
    });
  });

  afterEach(() => {
    vi.doUnmock(SERVER_TREES);
  });

  it("loads them with the first server tree, once", async () => {
    const islands = await import("../client/islands-runtime");
    expect(imports).toBe(0);

    const source = document.createElement("div");
    await expect(islands.createFarmServerTreeLayout(React, source, "/", options)).resolves.toBe(
      "layout",
    );
    await expect(
      islands.createFarmServerTreeElement(React, source, { ...options, key: "/a" }),
    ).resolves.toBe("page");

    expect(imports).toBe(1);
    expect(createServerTreeLayout).toHaveBeenCalledWith(source, "/", options);
    expect(createServerTreeElement).toHaveBeenCalledWith(source, {
      load: options.load,
      ServerHtml: options.ServerHtml,
      key: "/a",
    });
  });

  it("imports them again after an import fails", async () => {
    failures = 1;
    const islands = await import("../client/islands-runtime");
    const source = document.createElement("div");

    // Vitest wraps the factory's error in its own.
    await expect(islands.createFarmServerTreeElement(React, source, options)).rejects.toThrow();
    await expect(islands.createFarmServerTreeElement(React, source, options)).resolves.toBe("page");
    expect(imports).toBe(2);
  });
});
