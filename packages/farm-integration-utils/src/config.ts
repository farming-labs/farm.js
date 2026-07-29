import type { FarmIntegrationConfigDefinition } from "@farm.js/core";

type ConfigKey<TConfig> = Extract<keyof TConfig, string>;

export interface ResolvedIntegrationConfigOptions<TConfig extends object> {
  label: string;
  env?: Partial<Record<ConfigKey<TConfig>, string | readonly string[]>>;
  defaults?: Partial<TConfig>;
  input?: Partial<TConfig>;
  required?: readonly ConfigKey<TConfig>[];
}

export function integrationConfig<TConfig extends object>(
  options: ResolvedIntegrationConfigOptions<TConfig>,
): FarmIntegrationConfigDefinition<TConfig> {
  return {
    env: options.env as Record<string, string | readonly string[]> | undefined,
    defaults: options.defaults,
    input: options.input,
    schema: {
      safeParse(value) {
        const data = (isObject(value) ? value : {}) as TConfig;
        const issues =
          options.required
            ?.filter((key) => isMissingConfigValue(data[key]))
            .map((key) => ({
              path: [key],
              code: "required",
              message: `${options.label} requires ${String(key)}.`,
            })) ?? [];

        if (issues.length > 0) {
          return {
            success: false,
            error: {
              issues,
            },
          };
        }

        return {
          success: true,
          data,
        };
      },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMissingConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}
