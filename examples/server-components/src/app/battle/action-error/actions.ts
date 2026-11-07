"use server";

export async function failingAction(): Promise<string> {
  throw new Error("battle: the action failed");
}

export async function likeAction(count: number): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return count + 1;
}

let saved = "";

export async function saveAction(formData: FormData) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  saved = String(formData.get("note") ?? "");
}

export async function readSaved() {
  return saved;
}
