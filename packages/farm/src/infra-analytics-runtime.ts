/**
 * `@farm.js/core/internal/infra-analytics-runtime`, imported only by Farm's generated
 * production server. The exports are typed structurally on purpose: typing this entry
 * against FarmPlugin made the declaration build load the whole plugin type graph again,
 * which pushed core's DTS build past CI's 8 GB heap on Node 22.
 */
import {
  createFarmInfraAnalyticsPlugin as createPlugin,
  createFarmInfraAnalyticsRecorder as createRecorder,
} from "./plugins/infra-analytics";

/** Accepting the WebMCP tool calls the app's pages report; see FarmInfraAnalyticsWebMCPOptions. */
interface RuntimeOptions {
  webmcp?: { route?(pathname: string): object | null | undefined };
}

/** Farm's analytics plugin when the environment links the app to Farm Infra, else null. */
export const createFarmInfraAnalyticsPlugin: (
  options?: RuntimeOptions,
) => { name: string } | null = (options) => createPlugin(undefined, undefined, options);

/** The same reporting for a server without a plugin runtime, else null. */
export const createFarmInfraAnalyticsRecorder: (options?: RuntimeOptions) => {
  record(
    request: Request,
    options: { kind?: string; route?: { pattern?: string } },
    waitUntil: ((promise: Promise<unknown>) => void) | undefined,
    handler: () => Promise<Response>,
  ): Promise<Response>;
  close(): Promise<void>;
} | null = (options) => createRecorder(undefined, undefined, options);
