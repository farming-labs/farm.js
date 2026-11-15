import { redirect } from "@farm.js/core/navigation";

// Resolves after the loading boundary's shell, like a session lookup would.
export default async function AsyncRedirectPage() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  redirect("/redirect-e2e/target?from=async");
}
