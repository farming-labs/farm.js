import { redirect } from "@farm.js/core/navigation";

export const dynamic = "force-dynamic";

export default function RedirectPage(): never {
  redirect("/next/target");
}
