"use server";
import { redirect } from "@farm.js/core/navigation";

export async function finish(): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  redirect("/next/target");
}
