import { ActionErrorButton } from "../../../components/battle/action-error";
import { failingAction } from "./actions";

export default function ActionErrorPage() {
  return (
    <section>
      <h1>Action error</h1>
      <ActionErrorButton fail={failingAction} />
    </section>
  );
}
