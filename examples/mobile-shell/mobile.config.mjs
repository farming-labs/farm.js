// The config object the spike's route generator reads. In phase 2 this becomes
// `mobile: {}` in farm.config.ts (RFC 0004, section 7.2).

/** @type {import("./scripts/generate-routes.mjs").MobileShellConfig} */
export default {
  // The emulator reaches the host loopback at 10.0.2.2. `farm dev` serves 3000,
  // `pnpm start` (production) serves 3001. The shell accepts `-e server <url>`
  // at launch to switch without a rebuild.
  server: "http://10.0.2.2:3000",
  tabs: [
    { path: "/notes", title: "Notes", icon: "notes" },
    { path: "/settings", title: "Settings", icon: "settings" },
  ],
  // Per-route presentation. Routes not listed here push.
  routes: {
    "/notes/new": { presentation: "modal" },
  },
  // Pre-warmed WebViews that back push transitions. Each one loads warmPath so
  // the Farm client runtime is already running when a screen is pushed.
  pool: { size: 2, warmPath: "/notes" },
  // Device plugins exposed through the bridge.
  native: ["haptics"],
};
