"use client";
import {
  Component,
  Suspense,
  forwardRef,
  lazy,
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

export const MemoCounter = memo(function MemoCounter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="memo" onClick={() => setCount(count + 1)}>
      {`${label}: ${count}`}
    </button>
  );
});

export const RefInput = forwardRef<HTMLInputElement, { placeholder: string }>(function RefInput(
  { placeholder },
  ref,
) {
  const [value, setValue] = useState("");
  return (
    <label>
      Ref field
      <input ref={ref} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      <span data-testid="ref-echo">{value}</span>
    </label>
  );
});

export class ClassCounter extends Component<{ start: number }, { count: number }> {
  state = { count: this.props.start };
  render() {
    return (
      <button type="button" data-testid="class" onClick={() => this.setState(({ count }) => ({ count: count + 1 }))}>
        {`class: ${this.state.count}`}
      </button>
    );
  }
}

const LazyPanel = lazy(() => import("./shapes-lazy"));

export function LazyBox() {
  return (
    <Suspense fallback={<p data-testid="lazy">loading</p>}>
      <LazyPanel />
    </Suspense>
  );
}

// Renders nothing on the server and in the first client render, then shows up after hydration.
export function AppearsAfterHydration() {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return shown ? <p data-testid="appears">hydrated</p> : null;
}

export function FragmentRoot() {
  const [count, setCount] = useState(0);
  return (
    <>
      <span data-testid="fragment-text">{`fragment ${count}`}</span>
      <button type="button" data-testid="fragment" onClick={() => setCount(count + 1)}>
        add
      </button>
    </>
  );
}

export function StringRoot({ text }: { text: string }) {
  return text;
}

export function Tricky({ text }: { text: string }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <p data-testid="tricky" data-hydrated={String(hydrated)}>
      {text}
    </p>
  );
}

export function MetaSetter({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  return (
    <>
      <meta name={name} content={`count ${count}`} />
      <button type="button" data-testid="meta" onClick={() => setCount(count + 1)}>
        recount
      </button>
    </>
  );
}

let storeValue = "client";
const subscribe = () => () => {};
export function StoreReader() {
  const value = useSyncExternalStore(
    subscribe,
    () => storeValue,
    () => "server",
  );
  return <p data-testid="store">{value}</p>;
}

export function TransitionAction({ action }: { action: (name: string) => Promise<string> }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState("");
  const clicks = useRef(0);
  return (
    <div>
      <button
        type="button"
        data-testid="transition"
        onClick={() =>
          startTransition(async () => {
            clicks.current += 1;
            setResult(await action(`call ${clicks.current}`));
          })
        }
      >
        run
      </button>
      <p data-testid="transition-state">{pending ? "pending" : result || "idle"}</p>
    </div>
  );
}
