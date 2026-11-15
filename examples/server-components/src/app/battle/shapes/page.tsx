import {
  AppearsAfterHydration,
  ClassCounter,
  FragmentRoot,
  LazyBox,
  MetaSetter,
  MemoCounter,
  RefInput,
  StoreReader,
  StringRoot,
  Tricky,
  TransitionAction,
} from "../../../components/battle/shapes";
import { slowEcho } from "./actions";

const TRICKY = "</script><script>window.__battlePwned = 1</script>     <!-- end";

export default function ShapesPage() {
  return (
    <section>
      <h1>Shapes</h1>
      <MemoCounter label="memo" />
      <RefInput placeholder="type here" />
      <ClassCounter start={5} />
      <LazyBox />
      <AppearsAfterHydration />
      <FragmentRoot />
      <div data-testid="string-root">
        <StringRoot text="just text" />
      </div>
      <Tricky text={TRICKY} />
      <MetaSetter name="battle-island" />
      <StoreReader />
      <TransitionAction action={slowEcho} />
    </section>
  );
}
