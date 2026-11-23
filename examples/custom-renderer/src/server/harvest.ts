import { CROPS } from "./crops";

/** A slow data source, so the page has something to stream past. */
export async function readHarvest() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return CROPS.map((name, index) => ({ name, tonnes: (index + 1) * 12 }));
}
