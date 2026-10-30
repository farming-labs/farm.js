"use client";

import { ConvexProvider, ConvexProviderWithAuth } from "convex/react";

import { readConvexReactClient } from "./clients.js";
import { readTokenAuth } from "./token-auth.js";

import type { ConvexProviderProps } from "./types.js";

export const ConvexClientProvider = ({ url, tokenPath, children }: ConvexProviderProps) =>
  tokenPath ? (
    <ConvexProviderWithAuth client={readConvexReactClient(url)} useAuth={readTokenAuth(tokenPath)}>
      {children}
    </ConvexProviderWithAuth>
  ) : (
    <ConvexProvider client={readConvexReactClient(url)}>{children}</ConvexProvider>
  );
