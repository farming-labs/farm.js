import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// SvelteKit 3 takes its config in the Vite plugin. BENCH_TARGET picks the
// adapter; only the Node adapter is installed for the CI run.
const target = process.env.BENCH_TARGET ?? "node";
const { default: adapter } = await import(
  target === "vercel"
    ? "@sveltejs/adapter-vercel"
    : target === "cloudflare"
      ? "@sveltejs/adapter-cloudflare"
      : "@sveltejs/adapter-node"
);

export default defineConfig({
  plugins: [
    sveltekit({ adapter: adapter(target === "node" ? { precompress: false } : undefined) }),
  ],
});
