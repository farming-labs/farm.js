import { listTodos } from "../../server/todos";
import { addTodo } from "../action/actions";

export const dynamic = "force-dynamic";

// The page a middleware rewrite shows at /action-rewrite/alias.
export default function ActionRewritePage() {
  return (
    <section>
      <h1>Action rewrite</h1>
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
