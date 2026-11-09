// GET /  (and /api)
export function GET() {
  return Response.json({
    name: "farm-api-server-demo",
    endpoints: ["GET /todos", "POST /todos", "GET /todos/:id", "PATCH /todos/:id", "DELETE /todos/:id"],
    openapi: "/openapi.json",
    health: "/_farm/health/ready",
  });
}
