"use server";
import { ServerFnFailure } from "@farm.js/core/server-fn";

// A declared failure: the action refuses with its own status, as a server function does.
export async function reserveSeat(formData: FormData) {
  const seat = String(formData.get("seat") ?? "");
  throw new ServerFnFailure("sold_out", { seat }, { status: 409, message: `Seat ${seat} is taken` });
}
