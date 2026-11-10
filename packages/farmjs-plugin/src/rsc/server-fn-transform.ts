// Server functions become "use server" boundaries in both engines: the transform lives in core,
// which islands mode runs without this plugin.
export * from "@farm.js/core/internal/server-fn-transform";
