/**
 * Farm.js Query State Types
 */

import type { ComponentType, ReactNode } from 'react';

/**
 * Props for Farm.js page components with search params
 */


/**
 * Props for Farm.js layout components
 */
export interface LayoutPropsSafe {
  children: ReactNode;
  params: Record<string, string>;
}
export interface PagePropsSafe {
  params: Record<string, string>;
  searchParams: Promise<URLSearchParams | Record<string, string | string[] | undefined>>;
}
/**
 * Query state configuration for Farm.js
 */
export interface QueryStateConfig {
  /**
   * Default history method for URL updates
   * @default 'push'
   */
  defaultHistoryMethod?: 'push' | 'replace';
  
  /**
   * Default shallow routing behavior
   * @default true
   */
  shallow?: boolean;
  
  /**
   * Default scroll behavior
   * @default true
   */
  scroll?: boolean;
  
  /**
   * Custom serialization options
   */
  serialization?: {
    /**
     * Custom URL key mappings
     */
    urlKeys?: Record<string, string>;
    
    /**
     * Custom base URL for serialization
     */
    baseUrl?: string;
  };
}

/**
 * Farm.js specific query state context
 */
export interface FarmQueryStateContext {
  /**
   * Current search parameters
   */
  searchParams: URLSearchParams;
  
  /**
   * Current pathname
   */
  pathname: string;
  
  /**
   * Update URL with new search parameters
   */
  updateUrl: (params: Record<string, any>, options?: {
    method?: 'push' | 'replace';
    shallow?: boolean;
    scroll?: boolean;
  }) => void;
  
  /**
   * Clear all search parameters
   */
  clearParams: () => void;
}

/**
 * Higher-order component for providing query state context
 */
export type QueryStateProvider = ComponentType<{
  children: ReactNode;
  searchParams?: URLSearchParams;
  pathname?: string;
}>;
