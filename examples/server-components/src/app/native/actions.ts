"use server";
import { redirect } from "@farm.js/core/navigation";
import { addNativeNote } from "../../server/native-notes";

// Post/redirect/get: the browser, or the app's native screen, loads /native again.
export async function addNote(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  if (title) addNativeNote(title);
  redirect("/native");
}
