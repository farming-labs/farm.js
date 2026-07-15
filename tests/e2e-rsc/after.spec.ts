import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("after runs real page work once the response has finished", async ({ page }) => {
  const token = randomUUID();
  const markerPath = join(tmpdir(), `farm-after-${token}.json`);
  await rm(markerPath, { force: true });

  const response = await page.goto(`/after?token=${token}`);

  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("after-status")).toHaveText("scheduled");
  expect(existsSync(markerPath)).toBe(false);

  let marker: { completedAt: number; scheduledAt: number; token: string } | undefined;
  await expect
    .poll(
      async () => {
        try {
          marker = JSON.parse(await readFile(markerPath, "utf8"));
          return marker?.token;
        } catch {
          return undefined;
        }
      },
      { timeout: 5_000 },
    )
    .toBe(token);

  expect(marker!.completedAt - marker!.scheduledAt).toBeGreaterThanOrEqual(1_400);
  await rm(markerPath, { force: true });
});
