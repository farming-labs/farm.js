"use server";
import { bumpLayoutCount, bumpPageCount } from "../../server/layout-count";

export async function bumpLayout() {
  bumpLayoutCount();
}

export async function bumpPage() {
  bumpPageCount();
}
