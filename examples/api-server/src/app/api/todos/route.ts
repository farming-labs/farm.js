import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { createTodo, listTodos } from "../../../lib/todos";

// GET /todos?done=true
export const GET = createEndpoint(
  {
    query: z.object({
      done: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    }),
  },
  async ({ query }) => ({ todos: listTodos({ done: query.done }) }),
);

// POST /todos  { "title": "..." }
export const POST = createEndpoint(
  {
    body: z.object({ title: z.string().trim().min(1).max(200) }),
  },
  async ({ body }) => Response.json(createTodo(body.title), { status: 201 }),
);
