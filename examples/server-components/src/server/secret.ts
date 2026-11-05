// Must never reach a browser bundle; the contract suite searches the client JavaScript for it.
export const SERVER_ONLY_MARKER = "contract-server-only-7f3a9c";

export function secretLength(): number {
  return SERVER_ONLY_MARKER.length;
}
