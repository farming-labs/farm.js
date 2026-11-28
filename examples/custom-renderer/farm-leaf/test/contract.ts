// Fails type-checking when a module drifts from what Farm imports.
import type {
  FarmRendererClientModule,
  FarmRendererServerModule,
  FarmRendererViteModule,
} from "@farm.js/core/renderer";
import * as client from "../src/client.js";
import * as server from "../src/server.js";
import * as vite from "../src/vite.js";

export const serverContract: FarmRendererServerModule = server;
export const clientContract: FarmRendererClientModule = client;
export const viteContract: FarmRendererViteModule = vite;
