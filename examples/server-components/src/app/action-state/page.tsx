import { VoteForm } from "./vote-form";

export const dynamic = "force-dynamic";

// useActionState in a client component, posted with and without JavaScript.
export default function ActionStatePage() {
  return (
    <section>
      <h1>Action state</h1>
      <VoteForm />
    </section>
  );
}
