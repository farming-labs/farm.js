function endpoint(metadata) {
  const handler = async () => new Response();
  handler.__openapi = metadata;
  return handler;
}

export const GET = endpoint({
  responses: {
    200: {
      body: "json",
      description: "Current account",
      schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
});

export const POST = endpoint({
  responses: {
    204: { body: "empty", description: "Account removed" },
  },
});

export const PUT = endpoint({
  responses: {
    200: { body: "stream", contentType: "application/x-ndjson" },
  },
});

export const PATCH = endpoint({
  responses: {
    206: { body: "binary", contentType: "application/pdf" },
  },
});
