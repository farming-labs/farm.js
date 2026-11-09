import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { deleteTodo, getTodo, updateTodo } from "../../../../lib/todos";

function todoNotFound(id: string) {
  return Response.json({ error: "Todo not found", id }, { status: 404 });
}

// GET /todos/:id
export const GET = createEndpoint({}, async ({ params }) => {
  const id = String(params.id);
  return getTodo(id) ?? todoNotFound(id);
});

// PATCH /todos/:id  { "title"?: "...", "done"?: true }
export const PATCH = createEndpoint(
  {
    body: z
      .object({ title: z.string().trim().min(1).max(200), done: z.boolean() })
      .partial()
      .refine((changes) => Object.keys(changes).length > 0, "Send title, done, or both"),
  },
  async ({ params, body }) => {
    const id = String(params.id);
    return updateTodo(id, body) ?? todoNotFound(id);
  },
);

// DELETE /todos/:id
export const DELETE = createEndpoint({}, async ({ params }) => {
  const id = String(params.id);
  if (!deleteTodo(id)) return todoNotFound(id);
  return new Response(null, { status: 204 });
});
