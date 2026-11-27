// @vitest-environment jsdom

import { testClient } from "@farm.js/renderer-tests";
import * as clientRoots from "../renderer/react/client";
import * as serverRuntime from "../renderer/react/server";

testClient({
  reconcilesRerenders: true,
  name: "react",
  client: {
    ...clientRoots,
    createElement: serverRuntime.createElement,
    Suspense: serverRuntime.Suspense,
  },
  server: serverRuntime,
});
