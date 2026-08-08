import { getCurrentRequest } from "@farm.js/core/request";
import { auth } from "./auth";

export async function getServerSession() {
  return auth.api.getSession({
    headers: getCurrentRequest().headers,
  });
}
