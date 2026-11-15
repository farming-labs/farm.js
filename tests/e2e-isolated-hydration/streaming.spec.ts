import { expect, test } from "@playwright/test";

test("a layout that returns a whole <html> document streams its Suspense fallback first", async ({
  baseURL,
  page,
}) => {
  const response = await fetch(`${baseURL}/stream`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = "";
  let beforeContent = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    if (!beforeContent && received.includes("Loading slow content")) {
      if (!received.includes("Slow content arrived")) beforeContent = received;
    }
  }
  // The fallback went out with the composed head, before the slow content existed.
  expect(beforeContent).toContain("Loading slow content");
  expect(beforeContent).toMatch(/<link rel="stylesheet" href="[^"]+\.css">/);
  expect(beforeContent).toContain("<title>Isolated hydration example</title>");
  expect(beforeContent).toMatch(/<body[^>]*><div id="root">/);
  // One document, closed once, with the client after the streamed content.
  expect(received).toContain("Slow content arrived");
  expect(received.match(/<\/body>/g)).toHaveLength(1);
  expect(received.match(/<\/html>/g)).toHaveLength(1);
  expect(received.indexOf("Slow content arrived")).toBeLessThan(received.indexOf("__FARM_PROPS__"));
  expect(received.trimEnd().endsWith("</html>")).toBe(true);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/stream");
  await expect(page.getByTestId("slow-content")).toBeVisible();
  await expect(page.getByTestId("slow-fallback")).toHaveCount(0);
  const counter = page.getByTestId("counter");
  await expect(async () => {
    await counter.click({ timeout: 200 });
    await expect(counter).toHaveText(/count: [1-9]/, { timeout: 100 });
  }).toPass({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
