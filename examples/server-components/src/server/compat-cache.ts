import { randomUUID } from "node:crypto";
import { cache } from "react";

// One entry per request and id, as React Server Components memoize cache().
export const getEntry = cache(async (id: number) => ({ id, nonce: randomUUID() }));
