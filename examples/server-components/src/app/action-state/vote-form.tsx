"use client";
import { useActionState, useState } from "react";
import { vote, type VoteState } from "./actions";

export function VoteForm() {
  const [state, action, pending] = useActionState(vote, { count: 0, last: "none" } as VoteState);
  const [clicks, setClicks] = useState(0);
  return (
    <form action={action}>
      <p data-testid="vote-result">
        votes: {state.count}, last: {state.last}
      </p>
      <input name="choice" aria-label="Choice" defaultValue="tea" />
      <button type="submit" disabled={pending}>
        Vote
      </button>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Vote form clicks: {clicks}
      </button>
    </form>
  );
}
