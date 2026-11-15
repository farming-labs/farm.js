"use server";

export type VoteState = { count: number; last: string };

// A useActionState action: it gets the previous state and returns the next one.
export async function vote(previous: VoteState, formData: FormData): Promise<VoteState> {
  return { count: previous.count + 1, last: String(formData.get("choice") ?? "") };
}
