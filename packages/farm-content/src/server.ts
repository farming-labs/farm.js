import type { AppContentEntry, ContentCollectionName } from "./types.js";

function missingPlugin(): never {
  throw new Error(
    "[farm:content] The generated content runtime is unavailable. Add content({ collections }) to farm.config.ts and run this module through Farm.",
  );
}

/** Return every entry in a configured collection, ordered by entry ID. */
export async function getCollection<TName extends ContentCollectionName>(
  _name: TName,
): Promise<readonly AppContentEntry<TName>[]> {
  return missingPlugin();
}

/** Find one entry by its path-derived ID. */
export async function getEntry<TName extends ContentCollectionName>(
  _name: TName,
  _id: string,
): Promise<AppContentEntry<TName> | undefined> {
  return missingPlugin();
}

/** Find one entry by ID or throw an actionable error. */
export async function getEntryOrThrow<TName extends ContentCollectionName>(
  _name: TName,
  _id: string,
): Promise<AppContentEntry<TName>> {
  return missingPlugin();
}

export type {
  AppContentEntry,
  AppContentRegistry,
  ContentCollectionName,
  ContentEntry,
} from "./types.js";
