import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouteManager } from '../routing/route-manager'
import type { FarmConfig } from '../types'

// Mock the file system utilities
vi.mock('../utils', async () => {
  const actual = await vi.importActual('../utils')
  return {
    ...actual,
    globFiles: vi.fn(),
    resolveAppPath: vi.fn((root, ...paths) => `${root}/${paths.join('/')}`),
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }
})

describe('RouteManager', () => {
  let routeManager: RouteManager
  let mockConfig: Required<FarmConfig>

  beforeEach(() => {
    mockConfig = {
      root: '/test',
      srcDir: 'src',
      outDir: 'dist',
      basePath: '/',
      experimental: {
        serverComponents: true,
        serverActions: true
      },
      vite: {}
    }
    routeManager = new RouteManager(mockConfig)
  })

  describe('matchRoute', () => {
    beforeEach(async () => {
      // Mock discovered routes
      const { globFiles } = await import('../utils')
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes('page')) {
          return [
            'page.tsx',
            'about/page.tsx',
            'users/page.tsx',
            'users/[id]/page.tsx',
            'blog/[...slug]/page.tsx'
          ]
        }
        if (pattern.includes('layout')) {
          return [
            'layout.tsx',
            'users/layout.tsx'
          ]
        }
        return []
      })

      await routeManager.discoverRoutes()
    })

    it('should match root route', () => {
      const result = routeManager.matchRoute('/')
      expect(result.route).toBeTruthy()
      expect(result.params).toEqual({})
    })

    it('should match static routes', () => {
      const result = routeManager.matchRoute('/about')
      expect(result.route).toBeTruthy()
      expect(result.params).toEqual({})
    })

    it('should match dynamic routes', () => {
      const result = routeManager.matchRoute('/users/123')
      expect(result.route).toBeTruthy()
      expect(result.params).toEqual({ id: '123' })
    })

    it('should match catch-all routes', () => {
      const result = routeManager.matchRoute('/blog/2024/01/hello-world')
      expect(result.route).toBeTruthy()
      expect(result.params).toEqual({ slug: '2024/01/hello-world' })
    })

    it('should return null for non-matching routes', () => {
      const result = routeManager.matchRoute('/non-existent')
      expect(result.route).toBeNull()
    })

    it('should find matching layouts', () => {
      const result = routeManager.matchRoute('/users/123')
      expect(result.layouts.length).toBeGreaterThan(0)
    })
  })

  describe('discoverRoutes', () => {
    it('should discover page and layout files', async () => {
      const { globFiles } = await import('../utils')
      vi.mocked(globFiles).mockImplementation(async (pattern: string) => {
        if (pattern.includes('page')) {
          return ['page.tsx', 'about/page.tsx']
        }
        if (pattern.includes('layout')) {
          return ['layout.tsx']
        }
        return []
      })

      await routeManager.discoverRoutes()

      const routes = routeManager.getRoutes()
      const layouts = routeManager.getLayouts()

      expect(routes.size).toBe(2)
      expect(layouts.size).toBe(1)
    })
  })
})

