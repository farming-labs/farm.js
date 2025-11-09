import { createServer as createViteServer } from 'vite';
import type { FarmConfig } from '../types';
import { farmPlugin } from '../vite';
import { logger } from '../utils';
import { loadConfig, resolveConfig } from '../config';
import { PluginManager } from '../plugin';
import {
  createRedirectsPlugin,
  createHeadersPlugin,
  createRewritesPlugin,
  createEnvPlugin,
  createCompressionPlugin,
  createLoggerPlugin,
} from '../plugins';

/**
 * Create a Vite development server with Farm.js integration
 */
export async function createServer(config: FarmConfig = {}) {
  try {
    const root = config.root || process.cwd();

    // Load farm.config.ts if it exists
    const userConfig = await loadConfig(root);
    const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
    
    const resolvedConfig = userConfig ? await resolveConfig(userConfig, mode) : null;

    // Initialize plugin manager
    const pluginManager = new PluginManager({
      config: resolvedConfig || config,
      isDev: mode === 'development',
      isProd: mode === 'production',
    });

    // Add built-in plugins if config is available
    if (resolvedConfig) {
      const redirects = await resolvedConfig.redirects();
      const headers = await resolvedConfig.headers();
      const rewrites = await resolvedConfig.rewrites();

      if (redirects.length > 0) {
        pluginManager.addPlugin(createRedirectsPlugin(redirects));
      }

      if (headers.length > 0) {
        pluginManager.addPlugin(createHeadersPlugin(headers));
      }

      if (rewrites.length > 0) {
        pluginManager.addPlugin(createRewritesPlugin(rewrites));
      }

      if (resolvedConfig.env) {
        pluginManager.addPlugin(createEnvPlugin(resolvedConfig.env));
      }

      if (resolvedConfig.compress) {
        pluginManager.addPlugin(createCompressionPlugin());
      }

      if (resolvedConfig.plugins) {
        pluginManager.addPlugins(resolvedConfig.plugins);
      }
    }

    if (mode === 'development') {
      const hasLogger = pluginManager.getPlugins().some(p => p.name === 'farm:logger');
      if (!hasLogger) {
        pluginManager.addPlugin(createLoggerPlugin());
      }
    }

    // Run config hooks
    let finalConfig = resolvedConfig || config;
    finalConfig = await pluginManager.runHookSerial('config', finalConfig);

    const server = await createViteServer({
      root: finalConfig.root || process.cwd(),
      plugins: [farmPlugin(finalConfig, pluginManager)],
      server: {
        middlewareMode: false,
        hmr: {
          port: 24678,
        },
      },
      optimizeDeps: {
        include: ['react', 'react-dom'],
      },
      ssr: {
        noExternal: ['farm'],
      },
      ...(resolvedConfig?.vite || {}),
    });

    // Update plugin manager with vite server
    pluginManager.updateContext({ viteServer: server });

    // Run configResolved hooks
    await pluginManager.runHookParallel('configResolved', finalConfig);

    // Run buildStart hooks
    await pluginManager.runHookParallel('buildStart');

    return server;
  } catch (error) {
    logger.error(`Failed to create server: ${error}`);
    throw error;
  }
}

/**
 * Start the development server
 */
export async function startDevServer(config: FarmConfig = {}, port = 3000) {
  const server = await createServer(config);
  await server.listen(port);

  console.log('');
  logger.ready(` Farm.js 0.0.1`);
  console.log('');
  logger.event(`- Local:        http://localhost:${port}`);
  logger.event(`- Network:      use --host to expose`);
  console.log('');

  return server;
}
