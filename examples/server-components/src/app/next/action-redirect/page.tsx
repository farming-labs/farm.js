import { PendingForm } from "../../../components/pending";
import { finish } from "./actions";

export const dynamic = "force-dynamic";

// A server action that redirects, from a form whose button shows it is pending.
export default function ActionRedirectPage() {
  return (
    <section>
      <h1>Action redirect</h1>
      <PendingForm action={finish} />
    </section>
  );
}
