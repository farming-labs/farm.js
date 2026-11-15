import { Provider } from "jotai";
import { AtomCounter } from "../../../components/compat/jotai-counter";

// jotai's Provider straight from a server component: both counters share its store.
export default function JotaiPage() {
  return (
    <section>
      <h1>jotai</h1>
      <Provider>
        <AtomCounter name="first" />
        <p>Server text between the counters.</p>
        <AtomCounter name="second" />
      </Provider>
    </section>
  );
}
