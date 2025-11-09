import { TypedEndpoint } from "..";

export type APIClientOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
};

// Type utilities to extract endpoint input/output types from TypedEndpoint
type InferEndpointInput<T> = T extends {
  __types: {
    body: infer TBody;
    query: infer TQuery;
  };
}
  ? (TBody extends never
      ? TQuery extends never
        ? {}
        : { query?: TQuery }
      : TQuery extends never
      ? { body?: TBody }
      : { body?: TBody; query?: TQuery })
  : {};

type InferEndpointOutput<T> = T extends {
  __types: {
    response: infer R;
  };
}
  ? R
  : any;

// Type for a single endpoint method
type EndpointMethod<T = any> = (
  options?: InferEndpointInput<T>
) => Promise<InferEndpointOutput<T>>;

// Type for converting router structure to client structure
type RouterToClient<T> = {
  [K in keyof T]: T[K] extends Record<string, TypedEndpoint<any, any, any>>
    ? {
        [M in keyof T[K]]: M extends 'get' | 'post' | 'put' | 'delete' | 'patch'
          ? EndpointMethod<T[K][M]>
          : never;
      }
    : T[K] extends Record<string, any>
    ? RouterToClient<T[K]>  // Recurssive handling of the multi level api routes 
    : EndpointMethod<T[K]>;
};

/**
 * Create a typed RPC client for Farm.js API routes
 * 
 * Returns a nested proxy that supports:
 * - api.hello.get({ query: { name: 'World' } })
 * - api['auth/login'].post({ body: { email: '...', password: '...' } })
 * - api.users.get({ query: { limit: '10' } })
 * 
 * @example
 * ```typescript
 * import { createAPIClient } from 'farm/client';
 * import type { APIRouter } from '@/api';
 * 
 * export const api = createAPIClient<APIRouter>();
 * 
 * // Use it (nested property access)
 * const result = await api.hello.get({ query: { name: 'World' } });
 * 
 * // Or with string keys for nested paths
 * const result = await api['auth/login'].post({
 *   body: { email: 'test@example.com', password: 'pass123' }
 * });
 * ```
 */
export function createAPIClient<TRouter extends Record<string, any>>(
  options: APIClientOptions = {}
): RouterToClient<TRouter> {
  // Auto-detect baseURL
  const baseURL = options.baseURL || 
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

  // Create a simple fetch-based client (browser compatible)
  const fetchClient = async (path: string, requestOptions: any = {}) => {
    const url = new URL(path, baseURL);
    
    // Handle query parameters
    if (requestOptions.query) {
      Object.entries(requestOptions.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: requestOptions.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        ...requestOptions.headers,
      },
    };

    // Handle body
    if (requestOptions.body) {
      fetchOptions.body = JSON.stringify(requestOptions.body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  };

  // Return nested proxy (starts with empty path, user adds to it)
  return createNestedProxy([], fetchClient) as RouterToClient<TRouter>;
}

/**
 * Create a nested proxy that builds up the path
 * 
 * Flow:
 * 1. api.hello       -> Proxy(['hello'])
 * 2. api.hello.get   -> Proxy(['hello', 'get']) 
 * 3. api.hello.get({ query: {...} })
 *    -> fetch('/api/hello', { method: 'GET', ... })
 * 
 * For routes with single method:
 * 1. api.hello       -> Proxy(['hello'])
 * 2. api.hello({ query: {...} })
 *    -> fetch('/api/hello', ...)
 */
function createNestedProxy(path: string[], client: any): any {
  return new Proxy(() => {}, {
    // When accessing a property (api.hello)
    get(_target, prop: string) {
      // Add prop to path and return new proxy
      return createNestedProxy([...path, prop], client);
    },
    
    // When calling as a function
    apply(_target, _thisArg, args) {
      // Check if the last part is an HTTP method
      const lastPart = path[path.length - 1];
      const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
      
      if (httpMethods.includes(lastPart)) {
        // Method is explicitly called: api.users.get() or api['auth/login'].post()
        // Remove the method from path and use it as the HTTP method
        const routePath = '/api/' + path.slice(0, -1).join('/');
        const method = lastPart.toUpperCase();
        
        // Extract options from arguments
        const [options] = args;
        
        // Call fetch client with explicit method
        return client(routePath, {
          ...options,
          method
        });
      } else {
        // Direct call without method: api.hello()
        // Use the full path and let the server determine the method (usually GET)
        const routePath = '/api/' + path.join('/');
        
        // Extract options from arguments
        const [options] = args;
        
        // Call fetch client (default method will be GET)
        return client(routePath, {
          ...options,
          method: options?.method || 'GET'
        });
      }
    },
  });
}

/**
 * Server-side API client that calls endpoints directly as functions
 * No HTTP overhead, just direct function calls
 */
export function createServerAPIClient<TEndpoints extends Record<string, any>>(
  endpoints: TEndpoints
): TEndpoints {
  return endpoints;
}
