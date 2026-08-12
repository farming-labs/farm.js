// @vitest-environment jsdom

import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as clientRoots from "../renderer/react/client";
import * as serverRuntime from "../renderer/react/server";

defineRendererClientConformance({
  name: "react",
  client: {
    ...clientRoots,
    createElement: serverRuntime.createElement,
  },
  server: serverRuntime,
});
