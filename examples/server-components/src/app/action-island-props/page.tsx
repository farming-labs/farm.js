import { getPageCount } from "../../server/layout-count";
import { bumpPage } from "../action-layout/actions";

export const dynamic = "force-dynamic";

export default function ActionIslandPropsPage() {
  return (
    <section>
      <h1>Action island props</h1>
      <p data-testid="page-count">Page count: {getPageCount()}</p>
      <form action={bumpPage}>
        <button type="submit">Bump page</button>
      </form>
    </section>
  );
}
