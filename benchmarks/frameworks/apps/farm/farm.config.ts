import { defineConfig } from "@farm.js/core";

export default defineConfig({
  srcDir: "src",
  preset: "node-server",
  // The fixture has no images. It does not depend on Sharp either, but core keeps Sharp as a
  // devDependency, so inside this repo the build resolves it through core and copies ~16 MB of
  // libvips into the output: ~110ms of build time and an 18 MB artifact that an app installing
  // Farm from npm never gets, because an unresolvable optional peer turns optimization off by
  // itself. "none" is that same off state, so the measured build matches a default install and
  // the other four fixtures, none of which bundle an image optimizer.
  images: { provider: "none" },
  routeRules: {
    "/": { render: "dynamic" },
  },
});
