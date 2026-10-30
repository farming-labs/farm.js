"use server";
import { addTodoItem } from "../../server/todos";

export async function addTodo(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (title) addTodoItem(title);
}
