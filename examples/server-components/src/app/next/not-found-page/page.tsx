import { notFound } from "@farm.js/core/navigation";

export const dynamic = "force-dynamic";

export default function MissingPage(): never {
  notFound();
}
