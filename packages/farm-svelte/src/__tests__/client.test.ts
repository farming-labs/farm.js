// @vitest-environment jsdom

import { testClient } from "@farm.js/renderer-tests";
import * as clientRuntime from "../client";
import * as serverRuntime from "../server";

testClient({
  reconcilesRerenders: true,
  name: "svelte",
  client: clientRuntime,
  server: serverRuntime,
});
