"use client";

import { defineWebMCPTool, registerWebMCPTools } from "@farm.js/webmcp/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

interface Todo {
  id: number;
  label: string;
  completed: boolean;
}

const addTodoInput = z.object({ label: z.string().trim().min(1).max(120) });
const completeTodoInput = z.object({ id: z.number().int().positive() });

export function TodoWorkspace() {
  const [todos, setTodos] = useState<Todo[]>(() => [
    { id: 1, label: "Try the WebMCP tool inspector", completed: false },
  ]);
  const [supported, setSupported] = useState(false);
  const todosRef = useRef(todos);

  const tools = useMemo(
    () => [
      defineWebMCPTool({
        name: "list_todos",
        title: "List todos",
        description: "List the current todos and their completion state.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: true },
        async execute() {
          return { todos: todosRef.current };
        },
      }),
      defineWebMCPTool({
        name: "add_todo",
        title: "Add a todo",
        description: "Add one todo to the current list.",
        inputSchema: z.toJSONSchema(addTodoInput),
        validate: addTodoInput,
        async execute({ label }) {
          const todo = { id: Date.now(), label, completed: false };
          const next = [...todosRef.current, todo];
          todosRef.current = next;
          setTodos(next);
          return { added: todo };
        },
      }),
      defineWebMCPTool({
        name: "complete_todo",
        title: "Complete a todo",
        description: "Mark one current todo as completed by its numeric ID.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number", minimum: 1 } },
          required: ["id"],
          additionalProperties: false,
        },
        validate: completeTodoInput,
        async execute({ id }) {
          const exists = todosRef.current.some((todo) => todo.id === id);
          if (!exists) throw new Error(`Todo ${id} does not exist`);
          const next = todosRef.current.map((todo) =>
            todo.id === id ? { ...todo, completed: true } : todo,
          );
          todosRef.current = next;
          setTodos(next);
          return { completed: id };
        },
      }),
    ],
    [],
  );

  useEffect(() => registerWebMCPTools(tools), [tools]);
  useEffect(() => setSupported("modelContext" in document), []);

  return (
    <section className="workspace">
      <header>
        <div>
          <p className="eyebrow">@farm.js/webmcp</p>
          <h1>Give agents a small, explicit tool surface.</h1>
        </div>
        <span className={supported ? "status supported" : "status"}>
          {supported ? "WebMCP available" : "WebMCP unavailable"}
        </span>
      </header>

      <div className="grid">
        <article className="panel">
          <h2>Current todos</h2>
          <ul className="todos">
            {todos.map((todo) => (
              <li key={todo.id}>
                <span aria-hidden="true">{todo.completed ? "✓" : "○"}</span>
                <span className={todo.completed ? "done" : undefined}>{todo.label}</span>
                <code>{todo.id}</code>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Tools exposed on this route</h2>
          <ol className="tools">
            <li><code>list_todos</code><span>Read only</span></li>
            <li><code>add_todo</code><span>Validated with Zod</span></li>
            <li><code>complete_todo</code><span>Validated with Zod</span></li>
          </ol>
          <p className="note">
            In development, inspect <code>window.__FARM_WEBMCP__.getTools()</code>. The tools are
            removed when this component unmounts.
          </p>
        </article>
      </div>
    </section>
  );
}
