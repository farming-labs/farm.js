/**
 * Test defaults shared by every package's vitest config.
 *
 * Vitest allows a test 5s, which is not enough for the fixtures that bundle a config,
 * run a real build, or spawn a subprocess. Those take a couple of seconds on their own
 * and longer once the whole suite competes for the machine. Windows is slower again for
 * the same work, so it gets the same headroom as CI, as nuxt and next.js both do.
 */
const timeout = process.platform === "win32" || process.env.CI ? 60_000 : 30_000;

export const farmTestDefaults = {
  testTimeout: timeout,
  hookTimeout: timeout,
} as const;
