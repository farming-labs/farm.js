import { Counter } from "../../components/counter";
import { TodoForm } from "../../components/todo-form";
import { addTodoItem, listTodos } from "../../server/todos";

export const dynamic = "force-dynamic";

// Inline server actions: written in the server component, reading its variables. Those values
// travel with the action (sealed), not as hidden form fields anyone could change.
export default async function InlineActionPage() {
  const owner = { name: "Ada", since: new Date("2026-01-01T00:00:00.000Z") };
  const tag = "inline";

  async function addFromPage(formData: FormData) {
    "use server";
    const title = String(formData.get("title") ?? "").trim();
    if (title) addTodoItem(`${title} (${tag}, ${owner.name} since ${owner.since.getUTCFullYear()})`);
  }

  return (
    <section>
      <h1>Inline action</h1>
      <Counter start={0} label="Inline clicks" />
      <ul data-testid="items">
        {listTodos().map((todo, index) => (
          <li key={index}>{todo}</li>
        ))}
      </ul>
      <form action={addFromPage}>
        <input name="title" aria-label="Page item" />
        <button type="submit">Add from page</button>
      </form>
      <TodoForm action={addFromPage} />
    </section>
  );
}
