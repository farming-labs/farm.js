export interface Todo {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

// A process-local demo store: it resets on restart and is not shared between server
// instances. Use a database or Farm storage in a real app.
const todos = new Map<string, Todo>();
let nextId = 1;

export function createTodo(title: string): Todo {
  const todo: Todo = {
    id: String(nextId++),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  todos.set(todo.id, todo);
  return todo;
}

export function listTodos(filter: { done?: boolean } = {}): Todo[] {
  const all = [...todos.values()];
  return filter.done === undefined ? all : all.filter((todo) => todo.done === filter.done);
}

export function getTodo(id: string): Todo | undefined {
  return todos.get(id);
}

export function updateTodo(id: string, changes: Partial<Pick<Todo, "title" | "done">>) {
  const todo = todos.get(id);
  if (!todo) return undefined;
  const updated = { ...todo, ...changes };
  todos.set(id, updated);
  return updated;
}

export function deleteTodo(id: string): boolean {
  return todos.delete(id);
}

createTodo("Read the Farm.js backend guide");
