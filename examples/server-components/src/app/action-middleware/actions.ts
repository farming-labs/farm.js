"use server";
import { getMiddlewareContext } from "@farm.js/core/middleware";
import { setActionUser } from "../../server/action-middleware";

export async function recordUser() {
  setActionUser(String(getMiddlewareContext().get("user") ?? "missing"));
}
