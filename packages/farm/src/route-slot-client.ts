/**
 * Client source shared by the development and production client entries.
 *
 * A navigation keeps the layouts the old and new URL share and replaces the rest, but a kept
 * layout's slots (`@name` folders) render for the new URL, as a full load of it renders them. The
 * slot containers of the kept layouts take the server's containers for the new URL from `source`,
 * which holds the rendered route tree or, when the server rendered only the replaced layouts, the
 * kept slots on their own. A slot the new URL leaves without content is emptied.
 *
 * `onReplace` runs for each old container before it changes (to release what it held), and the
 * new containers are returned. Containers inside `replacedTarget` are replaced with it instead.
 */
export const FARM_KEPT_ROUTE_SLOTS_CLIENT_SOURCE = String.raw`
function replaceFarmKeptRouteSlots(currentRoot, replacedTarget, source, onReplace) {
  const placed = [];
  for (const container of Array.from(currentRoot.querySelectorAll("[data-farm-route-slot][id]"))) {
    if (!container.isConnected || replacedTarget.contains(container)) continue;
    const next = source.querySelector("#" + CSS.escape(container.id));
    if (onReplace) onReplace(container);
    if (!next) {
      container.replaceChildren();
      continue;
    }
    container.replaceWith(next);
    placed.push(next);
  }
  return placed;
}
`;
