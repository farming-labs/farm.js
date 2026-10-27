import { Counter } from "../components/counter";
import { secretLength } from "../server/secret";

export default function HomePage() {
  return (
    <section>
      <h1>Home</h1>
      <p data-testid="server-value">{`Server value length: ${secretLength()}`}</p>
      <Counter start={5} />
    </section>
  );
}
