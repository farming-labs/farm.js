import picocolors from "picocolors";

/**
 * Create colors for Farm's terminal output.
 *
 * Some interactive terminal hosts advertise a limited TERM value or set
 * NO_COLOR for captured subprocess output even though they render ANSI styles.
 * Prefer the actual stream type so the dev server remains colored in a TTY,
 * while redirected output stays plain.
 */
export function createCliColors(interactive = process.stdout.isTTY === true) {
  return picocolors.createColors(interactive);
}
