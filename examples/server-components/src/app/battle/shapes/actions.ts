"use server";

export async function slowEcho(name: string) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return `done ${name}`;
}
