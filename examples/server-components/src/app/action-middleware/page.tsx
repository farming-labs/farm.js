import { getActionUser } from "../../server/action-middleware";
import { recordUser } from "./actions";

export const dynamic = "force-dynamic";

export default function ActionMiddlewarePage() {
  return (
    <section>
      <h1>Action middleware</h1>
      <p data-testid="action-user">{getActionUser()}</p>
      <form action={recordUser}>
        <button type="submit">Record user</button>
      </form>
    </section>
  );
}
