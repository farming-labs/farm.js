/**
 * Server HTML for an island whose root component calls `createUniqueId()`
 * before its first element. renderer.test.ts asserts the server renderer
 * produces it; client-island.test.tsx hydrates it.
 */
export const UNIQUE_ID_ISLAND_HTML =
  '<div data-hk="10" id="__farm_page__" data-farm-island="page" data-farm-solid-render-id="0">' +
  '<button data-hk="01" type="button" id="00">count: <!--$-->0<!--/--></button></div>';
