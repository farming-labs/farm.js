"use server";

let touches = 0;

// Changes nothing the page shows: the page refreshes after it, as after any action.
export async function touch() {
  touches++;
  return touches;
}
