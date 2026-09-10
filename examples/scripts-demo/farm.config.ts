import { defineConfig } from "@farm.js/core";
import { scripts } from "@farm.js/scripts";
import { analytics, supportChat } from "./src/lib/scripts";

export default defineConfig({
  plugins: [scripts({ scripts: [analytics, supportChat] })],
});
