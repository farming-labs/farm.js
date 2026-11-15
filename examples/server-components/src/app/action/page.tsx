import { listTodos } from "../../server/todos";
import { addTodo } from "./actions";

export const dynamic = "force-dynamic";

export default function ActionPage() {
  return (
    <section>
      <h1>Action</h1>
      <ul data-testid="todos">
        {listTodos().map((todo, index) => (
          <li key={index}>{todo}</li>
        ))}
      </ul>
      <form action={addTodo}>
        <input name="title" aria-label="Title" />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}
