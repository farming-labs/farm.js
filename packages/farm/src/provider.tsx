import React, { createContext, useContext, type ReactNode } from "react";
import type { FarmConfig } from "./types";
import { normalizeFarmBasePath } from "./base-path";

interface FarmContextValue {
  config: FarmConfig;
  basePath: string;
}

// Made on first use: importing @farm.js/core must work where React has no createContext (the
// RSC engine's react-server environment, which loads API routes that import createEndpoint).
let farmContext: React.Context<FarmContextValue | null> | undefined;
function getFarmContext(): React.Context<FarmContextValue | null> {
  return (farmContext ??= createContext<FarmContextValue | null>(null));
}

interface FarmProviderProps {
  children: ReactNode;
  config: FarmConfig;
}

/**
 * Farm.js context provider for client-side components
 */
export function FarmProvider({ children, config }: FarmProviderProps) {
  const value: FarmContextValue = {
    config,
    basePath: normalizeFarmBasePath(config.basePath),
  };

  const FarmContext = getFarmContext();
  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

/**
 * Hook to access Farm.js configuration and utilities
 */
export function useFarm(): FarmContextValue {
  const context = useContext(getFarmContext());

  if (!context) {
    throw new Error("useFarm must be used within a FarmProvider");
  }

  return context;
}

/** @internal Read Farm context when a component can also use a runtime fallback. */
export function useOptionalFarm(): FarmContextValue | null {
  return useContext(getFarmContext());
}

/**
 * Hook to get the current base path
 */
export function useBasePath(): string {
  const { basePath } = useFarm();
  return basePath;
}
