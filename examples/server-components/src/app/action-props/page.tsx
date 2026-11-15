import { Counter } from "../../components/counter";
import { TodoForm } from "../../components/todo-form";
import { listTodos } from "../../server/todos";
import { addTodo } from "../action/actions";

export const dynamic = "force-dynamic";

export default function ActionPropsPage() {
  return (
    <section>
      <h1>Action props</h1>
      <Counter start={0} label="Island clicks" />
      <ul data-testid="items">
        {listTodos().map((todo, index) => (
          <li key={index}>{todo}</li>
        ))}
      </ul>
      <TodoForm action={addTodo} />
    </section>
  );
}
