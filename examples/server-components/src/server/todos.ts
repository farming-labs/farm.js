const todos: string[] = ["Write the contract"];

export function listTodos(): string[] {
  return [...todos];
}

export function addTodoItem(title: string): void {
  todos.push(title);
}
