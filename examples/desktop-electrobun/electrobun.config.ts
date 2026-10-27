import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Farm Notes",
    identifier: "dev.farmjs.examples.desktop-notes",
    version: "0.0.1",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "desktop/main.ts",
    },
    // The Farm server output from `farm build --preset bun`. The main process
    // imports Resources/app/farm/server/index.mjs at launch.
    copy: {
      ".farm/.output": "farm",
    },
    mac: {
      bundleCEF: false,
      createDmg: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
