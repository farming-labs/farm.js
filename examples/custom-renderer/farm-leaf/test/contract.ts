// Fails type-checking when a module drifts from what Farm imports.
import type {
  FarmRendererClientRuntime,
  FarmRendererViteModule,
  FarmServerRendererRuntime,
} from "@farm.js/core/renderer";
import * as client from "../src/client.js";
import * as server from "../src/server.js";
import * as vite from "../src/vite.js";

export const serverContract: FarmServerRendererRuntime = server;
export const clientContract: FarmRendererClientRuntime = client;
export const viteContract: FarmRendererViteModule = vite;
