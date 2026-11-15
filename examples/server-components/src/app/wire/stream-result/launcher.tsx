"use client";
import { use, useState } from "react";
import { Words } from "../../../components/wire/words";
import { launch } from "./actions";

function Status({ status }: { status: Promise<string> }) {
  return <p data-testid="launch-status">{use(status)}</p>;
}

export function Launcher() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof launch>> | null>(null);
  return (
    <div>
      <button type="button" onClick={async () => setResult(await launch())}>
        Launch
      </button>
      {result ? <Words label="countdown" words={result.countdown} /> : null}
      {result ? <Status status={result.status} /> : null}
    </div>
  );
}
