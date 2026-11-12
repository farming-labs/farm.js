import { Counter } from "../../components/counter";
import { listKeyedItems } from "../../server/keyed-items";
import { removeFirst } from "./actions";

export const dynamic = "force-dynamic";

// Client components in keyed lists: an action that removes an item keeps each one's state with its
// key, as React does, in a list keyed on the component and in one keyed on its parent element.
export default async function ActionKeyedPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const list = (await searchParams).list ?? "default";
  const items = listKeyedItems(list);
  return (
    <section>
      <h1>Keyed action</h1>
      <div data-testid="keyed-components">
        {items.map((name) => (
          <Counter key={name} start={0} label={`Component ${name}`} />
        ))}
      </div>
      <ul data-testid="keyed-parents">
        {items.map((name) => (
          <li key={name}>
            <Counter start={0} label={`Parent ${name}`} />
          </li>
        ))}
      </ul>
      <form action={removeFirst}>
        <input type="hidden" name="list" value={list} />
        <button type="submit">Remove first</button>
      </form>
    </section>
  );
}
