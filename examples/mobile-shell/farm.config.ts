import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: { provider: "none" },
  // The Android shell's tabs start at /notes and /settings. Browsers that open
  // the bare origin land on the notes tab too.
  async redirects() {
    return [{ source: "/", destination: "/notes", permanent: false }];
  },
});
