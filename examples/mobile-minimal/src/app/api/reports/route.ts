import { createEndpoint } from "@farm.js/core/api";
import { addReport, REPORT_MAX } from "../../reports";
import { getTrail } from "../../trails";

// The trail page's form posts here, from a browser or from the app's native screen alike: an
// HTML form submission (the endpoint reads urlencoded and multipart bodies), then a redirect back
// to the trail (post/redirect/get).
export const POST = createEndpoint(async ({ body, request }) => {
  const form = (body ?? {}) as Record<string, unknown>;
  const trail = getTrail(String(form.trail ?? ""));
  if (!trail) return new Response("Unknown trail", { status: 404 });
  const back = new URL(`/trails/${trail.id}`, request.url);
  const text = String(form.text ?? "").trim();
  if (!text) {
    back.searchParams.set("error", "empty");
  } else {
    addReport({
      trail: trail.id,
      name: String(form.name ?? "").trim().slice(0, 60) || "A walker",
      text: text.slice(0, REPORT_MAX),
    });
  }
  return Response.redirect(back, 303);
});
