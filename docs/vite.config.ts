import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { docsMdx } from "@farming-labs/farmjs/vite";

export default defineConfig({
  plugins: [
    docsMdx({
      codeBlockThemes: {
        light: "github-light-default",
        dark: "vesper",
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@farming-labs\/theme\/browser$/,
        replacement: fileURLToPath(new URL("./src/lib/docs-theme-browser.ts", import.meta.url)),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    noExternal: ["lucide-react"],
  },
});
