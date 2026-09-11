import type { ServerResponse } from "node:http";
import { sendWebResponse } from "@farm.js/core/server";

export async function sendRscDevelopmentResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  const headers = new Headers(response.headers);
  headers.delete("transfer-encoding");

  await sendWebResponse(
    res,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}
