declare module "virtual:farm-msw-handlers" {
  import type { RequestHandler } from "msw";

  export const handlers: RequestHandler[];
}
