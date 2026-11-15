import type { PageProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";

const LAST = 3;

/** mobile.routes gives this route presentation: "replace", so steps render in one screen. */
export default function StepPage({ params }: PageProps) {
  const step = Math.min(Math.max(Number(params?.n) || 1, 1), LAST);
  return (
    <>
      <h1 className="page-title" data-testid="step">
        Step {step} of {LAST}
      </h1>
      <div className="actions">
        {step < LAST ? (
          <Link className="button" href={`/navigation/step/${step + 1}`} data-testid="next-step">
            Next step
          </Link>
        ) : (
          <Link className="button" href="/navigation">
            Done
          </Link>
        )}
      </div>
    </>
  );
}
