import { cacheSignal } from "react";
import { getEntry } from "../../../server/compat-cache";
import { getMemberEntry } from "../../../server/compat-cache-member";

export const dynamic = "force-dynamic";

async function Entry({ testId, member }: { testId: string; member?: boolean }) {
  const entry = await (member ? getMemberEntry : getEntry)(1);
  return <p data-testid={testId}>{`entry ${entry.id}: ${entry.nonce}`}</p>;
}

// cacheSignal() is the request's signal while it renders, which aborts when the request ends.
function Signal() {
  const signal = cacheSignal();
  return (
    <p data-testid="cache-signal">
      {signal ? `signal ${signal.aborted ? "aborted" : "live"}` : "signal none"}
    </p>
  );
}

export default function CachePage() {
  return (
    <section>
      <h1>cache</h1>
      <Entry testId="cache-first" />
      <Entry testId="cache-second" />
      <Entry testId="cache-member-first" member />
      <Entry testId="cache-member-second" member />
      <Signal />
    </section>
  );
}
