export async function createFarmLegacyRequest<TEvent extends { method?: string }>(
  event: TEvent,
  input: string | URL,
  headers: HeadersInit,
  readRawBody: (event: TEvent, encoding: false) => Promise<BodyInit | null | undefined>,
): Promise<Request> {
  const method = event.method || "GET";
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : ((await readRawBody(event, false)) ?? undefined);

  return new Request(input, { method, headers, body });
}
