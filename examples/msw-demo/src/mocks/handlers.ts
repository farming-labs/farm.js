import { delay, http, HttpResponse } from "@farm.js/msw/handlers";

export const handlers = [
  http.get("https://inventory.farm.test/status", async ({ request }) => {
    const surface = new URL(request.url).searchParams.get("surface");
    await delay(surface === "browser" ? 350 : 40);

    return HttpResponse.json({
      source: surface === "browser" ? "browser service worker" : "Node interceptor",
      status: "mocked",
      inventory: 24,
    });
  }),
];
