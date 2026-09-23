interface DemoEvent {
  event: string;
  properties: Record<string, unknown>;
  receivedAt: string;
}

const events: DemoEvent[] = [];

export async function GET() {
  return Response.json({ events });
}

export async function POST(request: Request) {
  const input = (await request.json()) as {
    event?: unknown;
    properties?: unknown;
  };
  if (
    typeof input.event !== "string" ||
    !input.properties ||
    typeof input.properties !== "object" ||
    Array.isArray(input.properties)
  ) {
    return Response.json({ error: "Invalid analytics event" }, { status: 400 });
  }

  events.unshift({
    event: input.event,
    properties: input.properties as Record<string, unknown>,
    receivedAt: new Date().toISOString(),
  });
  events.splice(5);
  return Response.json({ accepted: true }, { status: 202 });
}
