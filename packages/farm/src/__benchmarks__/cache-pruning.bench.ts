// @vitest-environment node
import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { FarmDataCache } from "../cache";

type Dependency = { tags: ReadonlySet<string>; createdVersion: number };
type PruningState = {
  entries: Map<string, Dependency>;
  activeGenerations: Set<Dependency>;
  invalidatedTagVersions: Map<string, number>;
};

// Control: the previous pruning method from 1307b964. Both cases run the
// current cache's public write path, differing only in this private method.
function previousPrune(this: PruningState): void {
  for (const [tag, invalidatedVersion] of this.invalidatedTagVersions) {
    const staleEntryNeedsVersion = Array.from(this.entries.values()).some(
      (entry) => entry.tags.has(tag) && entry.createdVersion < invalidatedVersion,
    );
    if (staleEntryNeedsVersion) continue;
    const activeGenerationNeedsVersion = Array.from(this.activeGenerations).some(
      (generation) => generation.tags.has(tag) && generation.createdVersion < invalidatedVersion,
    );
    if (!activeGenerationNeedsVersion) this.invalidatedTagVersions.delete(tag);
  }
}

function fixture(
  previous: boolean,
  invalidatedTags: number,
  dependencyLast: boolean,
): FarmDataCache {
  const cache = new FarmDataCache();
  if (previous)
    Object.defineProperty(cache, "pruneInvalidatedTagVersions", { value: previousPrune });
  const tags = Array.from({ length: invalidatedTags }, (_, index) => `tag-${index}`);
  if (!dependencyLast) cache.set("stale", "old", { tags });
  for (let index = 1; index < 1_024; index++) cache.set(`other-${index}`, index);
  if (dependencyLast) cache.set("stale", "old", { tags });
  for (const tag of tags) cache.revalidateTag(tag);
  cache.set("other-1023", 1_023);
  assert.equal(cache.get("other-1023"), 1_023);
  assert.equal(cache.get("stale"), invalidatedTags ? undefined : "old");
  // Read-only inspection does not alter the stale dependency's LRU position.
  assert.equal((cache as unknown as PruningState).invalidatedTagVersions.size, invalidatedTags);
  return cache;
}

for (const [tags, dependencyLast] of [
  [0, false],
  [1, false],
  [100, false],
  [100, true],
] as const) {
  describe(`write with 1,024 entries and ${tags} invalidated tags (dependency ${dependencyLast ? "late" : "first"})`, () => {
    const previous = fixture(true, tags, dependencyLast);
    const current = fixture(false, tags, dependencyLast);
    bench("previous array-copy pruning", () => {
      previous.set("other-1023", 1_023);
    });
    bench("iterator pruning", () => {
      current.set("other-1023", 1_023);
    });
  });
}
