import type { FarmPlugin } from '../plugin';

export function createEnvPlugin(env: Record<string, string>): FarmPlugin {
  return {
    name: 'farm:env',

    config(config, context) {
      // Inject environment variables into the config
      return {
        ...config,
        env: {
          ...(config as any).env,
          ...env,
        },
      } as any;
    },

    configResolved(config, context) {
      // Set environment variables for runtime
      for (const [key, value] of Object.entries(env)) {
        if (key.startsWith('FARM_') || key.startsWith('PUBLIC_')) {
          process.env[key] = value;
        }
      }
    },
  };
}
