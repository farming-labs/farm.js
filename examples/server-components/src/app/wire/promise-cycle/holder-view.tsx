"use client";
import { use, useState } from "react";
import { hold, type Holder } from "./actions";

export function HolderView({ holder }: { holder: Holder }) {
  const settled = use(holder.self!);
  const [clicks, setClicks] = useState(0);
  const [reply, setReply] = useState("");
  return (
    <div>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        {`${settled.name} ${String(settled === holder)} ${clicks}`}
      </button>
      <button
        type="button"
        onClick={async () => {
          const answer = await hold();
          const same = (await answer.self!) === answer;
          setReply(`${answer.name} ${String(same)}`);
        }}
      >
        Hold
      </button>
      <p data-testid="reply">{reply}</p>
    </div>
  );
}
