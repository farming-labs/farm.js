import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";
const reactivity = process.env.FARM_REACTIVITY === "static" ? "static" : "hybrid";
const compiler = compilerEnabled ? ({ reactivity, report: true } as const) : false;

export default defineConfig({
  // FARM_RENDERER=preact runs the same compiled app on Preact's React compatibility layer.
  renderer: process.env.FARM_RENDERER === "preact" ? preact({ compiler }) : react({ compiler }),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
