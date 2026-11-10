import { SubmitButton } from "../../../components/battle/submit-button";
import { readSaved, saveAction } from "../action-error/actions";

export const dynamic = "force-dynamic";

export default async function FormStatusPage() {
  return (
    <section>
      <h1>Form status</h1>
      <p data-testid="saved">{`saved: ${await readSaved()}`}</p>
      <form action={saveAction}>
        <input name="note" aria-label="Note" />
        <SubmitButton />
      </form>
    </section>
  );
}
