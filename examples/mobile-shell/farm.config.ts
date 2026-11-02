import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: { provider: "none" },
  // The Android shell's tabs start at /notes and /settings. Browsers that open
  // the bare origin land on the notes tab too.
  // The Android emulator reaches the host loopback at 10.0.2.2, which maps to
  // 127.0.0.1. Vite's default `localhost` can bind to ::1 only on macOS, and
  // `farm dev` has no --host flag yet, so pin IPv4 loopback here.
  vite: { server: { host: "127.0.0.1" } },
  async redirects() {
    return [{ source: "/", destination: "/notes", permanent: false }];
  },
});
