import type { APIRouteManager } from '../api/route-manager';
import type { H3Event } from 'h3';
import { getHeaders, readBody, setHeaders, setResponseStatus } from 'h3';

/**
 * Convert better-call API routes to Nitro-compatible handlers
 * 
 * This creates Nitro route handlers that wrap the better-call handlers,
 * allowing API routes to work in Nitro's universal server build.
 */
export async function createNitroAPIHandlers(
    apiRouteManager: APIRouteManager,
    appDir: string
): Promise<Record<string, any>> {
    const routes = apiRouteManager.getRoutes();
    const handlers: Record<string, any> = {};

    // Nitro expects routes in the format: /server/api/**/*.ts
    // We'll create handlers that match the existing API routes
    for (const [routePath, route] of routes) {
        for (const method of route.methods) {
            // Create a Nitro handler for this route
            const handlerPath = routePath.replace(/^\/api/, '/api');

            // Store handler with method in path for Nitro
            const handlerKey = `${handlerPath}.${method.toLowerCase()}`;

            handlers[handlerKey] = async (event: H3Event) => {
                try {
                    // Convert H3 event to Web Request
                    const url = getRequestURL(event);
                    const headers = new Headers();

                    // Copy headers
                    const h3Headers = getHeaders(event);
                    for (const [key, value] of Object.entries(h3Headers)) {
                        if (value) {
                            headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
                        }
                    }

                    // Get body
                    let body: string | undefined;
                    if (method !== 'GET' && method !== 'HEAD') {
                        const bodyData = await readBody(event).catch(() => undefined);
                        if (bodyData) {
                            body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
                        }
                    }

                    // Create Web Request
                    const request = new Request(url.toString(), {
                        method,
                        headers,
                        body: body || undefined,
                    });

                    // Call better-call handler
                    const betterCallHandler = apiRouteManager.getHandler();
                    if (!betterCallHandler) {
                        throw new Error('No API handler found');
                    }

                    const response = await betterCallHandler(request);

                    // Convert Response to H3 response
                    const responseBody = await response.text();
                    const responseHeaders: Record<string, string> = {};
                    response.headers.forEach((value, key) => {
                        responseHeaders[key] = value;
                    });

                    setResponseStatus(event, response.status);
                    setHeaders(event, responseHeaders);

                    return responseBody;
                } catch (error: any) {
                    setResponseStatus(event, 500);
                    return {
                        error: error.message || 'Internal Server Error',
                    };
                }
        }
    }

    return handlers;
}

// Helper to convert H3 event to standard format
function getRequestURL(event: H3Event): URL {
    if (!event.node) {
        return new URL('/', 'http://localhost:3000');
    }
    const protocol = event.node.req.headers['x-forwarded-proto'] || 'http';
    const host = event.node.req.headers.host || 'localhost';
    const path = event.node.req.url || '/';
    return new URL(path, `${protocol}://${host}`);
}

