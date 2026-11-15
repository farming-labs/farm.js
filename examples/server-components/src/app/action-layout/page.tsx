import { getPageCount } from "../../server/layout-count";
import { bumpLayout, bumpPage } from "./actions";

export const dynamic = "force-dynamic";

export default function ActionLayoutPage() {
  return (
    <section>
      <h1>Action layout</h1>
      <p data-testid="page-count">Page count: {getPageCount()}</p>
      <form action={bumpLayout}>
        <button type="submit">Bump layout</button>
      </form>
      <form action={bumpPage}>
        <button type="submit">Bump page</button>
      </form>
    </section>
  );
}
