import { readSecret } from "../../../server/compat-secret";

export default function ServerOnlyPage() {
  return (
    <section>
      <h1>server-only</h1>
      <p data-testid="secret-length">{`secret length ${readSecret().length}`}</p>
    </section>
  );
}
