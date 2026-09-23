// @vitest-environment jsdom

import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as clientRuntime from "../client";
import * as serverRuntime from "../server";

defineRendererClientConformance({
  reconcilesRerenders: true,
  name: "vue",
  client: clientRuntime,
  server: serverRuntime,
});
