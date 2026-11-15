import { redirect } from "@farm.js/core/navigation";

export default function RenderRedirectPage() {
  redirect("/redirect-e2e/target?from=render");
}
