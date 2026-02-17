/**
 * Manifest module exports
 */

export * from "./types";
export * from "./generator";

// Virtual module ID for the manifest
export const MANIFEST_VIRTUAL_MODULE_ID = "virtual:farm-manifest";
export const RESOLVED_MANIFEST_ID = "\0" + MANIFEST_VIRTUAL_MODULE_ID;
