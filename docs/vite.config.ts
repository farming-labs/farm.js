import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
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
