import { AsyncLocalStorage } from "node:async_hooks";
import { H3Event, fromWebHandler, toResponse as h3_toResponse } from "h3";

// Optional: If you want h3 utilities (cookies, sessions, etc.)
const eventStorage = new AsyncLocalStorage<{ h3Event: H3Event }>();

export type RequestHandler = (
  request: Request,
  requestOpts?: { context?: any },
) => Promise<Response> | Response;

/**
 * Wraps a Web Standard handler to provide h3 context (optional)
 * If you don't need h3, you can skip this and use the handler directly
 */
export function requestHandler(handler: RequestHandler): RequestHandler {
  return (request: Request, requestOpts?: any) => {
    const h3Event = new H3Event(request);

    const response = eventStorage.run({ h3Event }, () => handler(request, requestOpts));

    return h3_toResponse(response, h3Event);
  };
}

/**
 * Get h3 event from AsyncLocalStorage (for utilities like getCookie)
 */
export function getH3Event(): H3Event {
  const event = eventStorage.getStore();
  if (!event) {
    throw new Error("No H3Event found in AsyncLocalStorage");
  }
  return event.h3Event;
}
