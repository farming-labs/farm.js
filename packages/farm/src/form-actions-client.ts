/**
 * The browser side of islands-mode server actions, run by islx: a client component's import of a
 * `"use server"` module becomes a reference that calls the action, and an action passed as a prop
 * arrives as one. After an action the page refreshes through Farm's router, keeping island state;
 * a redirect is a client navigation.
 */
import { createServerReference } from "@farmjs/islx/client";

/** The reference for an action passed as a prop: one per action, so props keep their identity. */
export function getFarmFormActionStub(id: string) {
  return createServerReference(id);
}

export function createFarmFormActionStub(id: string) {
  return createServerReference(id);
}
