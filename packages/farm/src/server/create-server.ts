import { createServer as createViteServer } from 'vite'
import type { FarmConfig } from '../types'
import { farmPlugin } from '../vite'
import { logger } from '../utils'

/**
 * Create a Vite development server with Farm.js integration
 */
export async function createServer(config: FarmConfig = {}) {
  try {
    const server = await createViteServer({
      root: config.root || process.cwd(),
      plugins: [farmPlugin(config)],
      server: {
        middlewareMode: false,
        hmr: {
          port: 24678
        }
      },
      optimizeDeps: {
        include: ['react', 'react-dom']
      },
      ssr: {
        noExternal: ['farm']
      }
    })

    return server
  } catch (error) {
    logger.error(`Failed to create server: ${error}`)
    throw error
  }
}

/**
 * Start the development server
 */
export async function startDevServer(config: FarmConfig = {}, port = 3000) {
  const server = await createServer(config)
  await server.listen(port)
  
  logger.success(`🚜 Farm.js development server running at http://localhost:${port}`)
  
  return server
}

