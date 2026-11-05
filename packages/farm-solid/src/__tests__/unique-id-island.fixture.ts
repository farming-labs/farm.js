/**
 * Server HTML for an island whose root component calls `createUniqueId()`
 * before its first element. renderer.test.ts asserts the server renderer
 * produces it; client-island.test.tsx hydrates it.
 */
export const UNIQUE_ID_ISLAND_HTML =
  '<div data-hk="10" id="__farm_page__" data-farm-island="page" data-farm-solid-render-id="0">' +
  '<button data-hk="01" type="button" id="00">count: <!--$-->0<!--/--></button></div>';

/**
 * The same island as the page of a server-only layout that reads a resource.
 * The layout keeps its hydration keys, but its resource is not serialized, so
 * the document carries no hydration script.
 */
export const SERVER_LAYOUT_ISLAND_HTML =
  '<section data-hk="01"><p>a@example.com</p><div data-hk="030" id="__farm_page__" data-farm-segment="page" data-farm-client="true" data-farm-island="page" data-farm-solid-render-id="02">' +
  '<button data-hk="021" type="button" id="020">count: <!--$-->0<!--/--></button></div></section>';
