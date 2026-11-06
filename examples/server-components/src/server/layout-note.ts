// Read only by the context layout, a server component around a client provider. The marker is
// server output in the HTML, but must never be in a script: the layout renders on the server, as
// RSC or as an islands server tree, so its module never reaches the browser.
export const LAYOUT_SERVER_ONLY_MARKER = "contract-layout-server-only-2b7e1d";

export function layoutNote(): string {
  return `Layout note: ${LAYOUT_SERVER_ONLY_MARKER}`;
}
