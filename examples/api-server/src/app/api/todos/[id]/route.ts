import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { deleteTodo, getTodo, updateTodo } from "../../../../lib/todos";

// A declared failure: typed in the generated client and listed in the OpenAPI document.
const errors = {
  notFound: { status: 404, message: "Todo not found" },
} as const;

// GET /todos/:id
export const GET = createEndpoint({ errors }, async ({ params, error }) => {
  return getTodo(String(params.id)) ?? error("notFound");
});

// PATCH /todos/:id  { "title"?: "...", "done"?: true }
export const PATCH = createEndpoint(
  {
    body: z
      .object({ title: z.string().trim().min(1).max(200), done: z.boolean() })
      .partial()
      .refine((changes) => Object.keys(changes).length > 0, "Send title, done, or both"),
    errors,
  },
  async ({ params, body, error }) => updateTodo(String(params.id), body) ?? error("notFound"),
);

// DELETE /todos/:id
export const DELETE = createEndpoint({ errors }, async ({ params, error }) => {
  if (!deleteTodo(String(params.id))) return error("notFound");
  return new Response(null, { status: 204 });
});
