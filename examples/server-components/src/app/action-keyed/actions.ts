"use server";
import { removeFirstKeyedItem } from "../../server/keyed-items";

export async function removeFirst(formData: FormData) {
  removeFirstKeyedItem(String(formData.get("list") ?? ""));
}
