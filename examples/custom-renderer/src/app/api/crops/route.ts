import { CROPS } from "../../../server/crops";

export function GET() {
  return Response.json({ crops: CROPS, renderer: "leaf" });
}
