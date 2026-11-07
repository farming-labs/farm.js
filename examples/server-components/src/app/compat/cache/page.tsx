import { getEntry } from "../../../server/compat-cache";

export const dynamic = "force-dynamic";

async function Entry({ testId }: { testId: string }) {
  const entry = await getEntry(1);
  return <p data-testid={testId}>{`entry ${entry.id}: ${entry.nonce}`}</p>;
}

export default function CachePage() {
  return (
    <section>
      <h1>cache</h1>
      <Entry testId="cache-first" />
      <Entry testId="cache-second" />
    </section>
  );
}
