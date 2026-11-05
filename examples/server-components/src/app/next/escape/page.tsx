import { Suspense } from "react";
import { Echo } from "../../../components/echo";
import { ESCAPE_TEXT } from "../../../server/escape";

export const dynamic = "force-dynamic";

async function LateText() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return <p data-testid="streamed-text">{ESCAPE_TEXT}</p>;
}

// Text that would break out of a script or comment if it were not escaped: in server HTML, in a
// client component's props, and in a streamed boundary.
export default function EscapePage() {
  return (
    <section>
      <h1>Escape</h1>
      <p data-testid="server-text">{ESCAPE_TEXT}</p>
      <Echo text={ESCAPE_TEXT} />
      <Suspense fallback={<p>Loading</p>}>
        <LateText />
      </Suspense>
    </section>
  );
}
