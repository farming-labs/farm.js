import { randomUUID } from "node:crypto";
import * as React from "react";

// The same loader through React.cache, as libraries written for RSC often call it.
export const getMemberEntry = React.cache(async (id: number) => ({ id, nonce: randomUUID() }));
