import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The platform benchmark runs each app as its own project.
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default config;
