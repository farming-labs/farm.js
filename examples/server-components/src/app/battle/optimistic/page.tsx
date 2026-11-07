import { OptimisticLikes } from "../../../components/battle/optimistic";
import { likeAction } from "../action-error/actions";

export default function OptimisticPage() {
  return (
    <section>
      <h1>Optimistic</h1>
      <OptimisticLikes like={likeAction} />
    </section>
  );
}
