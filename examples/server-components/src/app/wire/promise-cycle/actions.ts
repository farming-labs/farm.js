"use server";

export type Holder = { name: string; self?: Promise<Holder> };

// Answers with an object whose promise settles to that object.
export async function hold() {
  const holder: Holder = { name: "reply" };
  holder.self = Promise.resolve(holder);
  return holder;
}
