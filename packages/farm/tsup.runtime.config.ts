import { defineConfig } from "tsup";
import { farmPackageBuildOptions } from "./tsup.config";

export default defineConfig({
  ...farmPackageBuildOptions,
  dts: false,
});
