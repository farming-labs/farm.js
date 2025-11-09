import type { H3Event } from 'h3';
import { defineEventHandler, setResponseStatus } from 'h3';
import type { RouteManager } from '../routing/route-manager';
import type { ServerRenderer } from '../server/renderer';

/**
 * Create SSR handler for Nitro
 * This handles all page requests and renders React Server Components
 * Based on Nitro's handler pattern from https://nitro.build/config
 */
export async function createNitroSSRHandler(
    routeManager: RouteManager,
    serverRenderer: ServerRenderer
) {
    return defineEventHandler(async (event: H3Event) => {
        try {
            if (!event.node) {
                setResponseStatus(event, 500);
                return { error: 'No Node.js request/response found' };
            }
            
            // Convert H3 event to Node.js request/response
            const req = event.node.req;
            const res = event.node.res;

            // Call the server renderer
            // The renderer will handle writing the response
            await serverRenderer.renderPage(req as any, res as any);
            
            // Return undefined to indicate response was handled
            return undefined;
        } catch (error: any) {
            setResponseStatus(event, 500);
            return {
                error: error.message || 'Internal Server Error',
            };
        }
    });
}

