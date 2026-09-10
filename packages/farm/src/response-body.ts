/** @internal */
export function omitFarmResponseBody(response: Response): Response {
  if (response.body) {
    void response.body.cancel().catch(() => undefined);
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
