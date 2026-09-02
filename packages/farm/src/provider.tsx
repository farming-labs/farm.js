import React, { createContext, useContext, type ReactNode } from "react";
import type { FarmConfig } from "./types";

interface FarmContextValue {
  config: FarmConfig;
  basePath: string;
}

const FarmContext = createContext<FarmContextValue | null>(null);

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
    basePath: config.basePath || "/",
  };

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

/**
 * Hook to access Farm.js configuration and utilities
 */
export function useFarm(): FarmContextValue {
  const context = useContext(FarmContext);

  if (!context) {
    throw new Error("useFarm must be used within a FarmProvider");
  }

  return context;
}

/** @internal Read Farm context when a component can also use a runtime fallback. */
export function useOptionalFarm(): FarmContextValue | null {
  return useContext(FarmContext);
}

/**
 * Hook to get the current base path
 */
export function useBasePath(): string {
  const { basePath } = useFarm();
  return basePath;
}
