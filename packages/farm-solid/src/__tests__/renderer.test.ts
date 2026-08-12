// @vitest-environment node

import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { describe, expect, it } from "vitest";
import { solid } from "../index";
import * as serverRuntime from "../server";
import { generateHydrationScript } from "../server";

defineRendererDescriptorConformance({
  name: "solid",
  createDescriptor: solid,
  expected: {
    vite: "@farm.js/solid/vite",
    server: "@farm.js/solid/server",
    client: "@farm.js/solid/client",
    jsxImportSource: "solid-js",
    capabilities: { streaming: { node: false, web: false } },
  },
});

defineRendererServerConformance(serverRuntime);

describe("Solid renderer", () => {
  it("provides Solid's hydration bootstrap for server documents", () => {
    expect(generateHydrationScript()).toContain("window._$HY");
  });
});
