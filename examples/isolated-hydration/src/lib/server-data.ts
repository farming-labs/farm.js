// Server-only module imported by the root layout. The token must appear in
// the rendered HTML but never in any client-served script: the layout that
// imports it is excluded from the browser graph by isolated hydration.
export const SERVER_ONLY_LAYOUT_TOKEN = "FARM_E2E_SERVER_ONLY_LAYOUT_TOKEN";

export const catalogSeed = [
  { id: "wheat", price: 12 },
  { id: "barley", price: 9 },
  { id: "rye", price: 14 },
];
