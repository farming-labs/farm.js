import { defineConfig } from "@farm.js/core";
import { partytown } from "@farm.js/partytown";
import { track } from "./src/lib/analytics";

export default defineConfig({
  plugins: [partytown({ forward: [track] })],
});
