import { CROPS } from "./crops";

/** The crop list after a delay, like a slow database or API call. */
export async function loadCropsSlowly(delayMs = 400) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return CROPS;
}
