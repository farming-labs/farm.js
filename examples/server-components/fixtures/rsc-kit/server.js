// The build React Server Components use for server code.
import { createElement as h } from "react";

export { KitProvider, KitValue } from "./provider.js";
export * from "./hooks.js";
export * from "./card.js";

export async function KitQuote({ topic }) {
  await Promise.resolve();
  return h("p", { "data-testid": "kit-quote" }, `kit quote about ${topic}, rendered on the server`);
}

export function kitGreeting(name) {
  return `hello ${name} from the server build`;
}
