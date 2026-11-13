"use server";

// Gives back what the browser sent, untouched: values the server cannot read travel back as they came.
export async function echo(sent: { point: unknown; pick: unknown; badge: unknown }) {
  return sent;
}

export async function join(...parts: string[]) {
  return parts.join(" ");
}

// Runs an action the browser sent, bound or not.
export async function run(action: (...args: string[]) => Promise<string>, ...args: string[]) {
  return action(...args);
}
