/**
 * @internal Server trees in the browser (islands mode): a page or layout that hydrates as one React
 * root. Loaded with the first one a page has, so a page of islands never loads them (RFC 0013).
 */
export { createServerTreeElement, createServerTreeLayout } from "@farm.js/islx/react/client";
