// The launch video's look: characters run through these signs before they settle.
const GLYPHS = "#%&/_<>*+=!?01";

export const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

/**
 * Scrambles between two strings through GLYPHS. Each character settles at its
 * own point (left to right, with jitter, reseeded every loop), and the string
 * grows or shrinks a character at a time between the two lengths.
 */
export function createScramble(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let settleAt: number[] = [];
  const reseed = () => {
    settleAt = Array.from({ length }, (_, index) => (index / length) * 0.7 + Math.random() * 0.3);
  };
  reseed();
  const at = (from: string, to: string, amount: number) => {
    if (amount <= 0) return from;
    if (amount >= 1) return to;
    const visible = Math.round(from.length + (to.length - from.length) * amount);
    let next = "";
    for (let index = 0; index < Math.min(length, visible); index += 1) {
      next += amount >= settleAt[index]! ? (to[index] ?? "") : randomGlyph();
    }
    return next;
  };
  /** Whether the character at `index` has settled by `amount`. */
  const settled = (index: number, amount: number) =>
    amount >= 1 || (amount > 0 && amount >= settleAt[index]!);
  return { reseed, at, settled };
}
