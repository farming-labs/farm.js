import { describe, it, expect } from 'vitest'
import { parseRoutePath, matchRoute, segmentsToPattern } from '../utils'

describe('parseRoutePath', () => {
  it('should parse static routes', () => {
    const result = parseRoutePath('about/page.tsx')
    expect(result.segments).toEqual([
      { segment: 'about', isDynamic: false, isOptional: false, isCatchAll: false }
    ])
    expect(result.type).toBe('page')
  })

  it('should parse dynamic routes', () => {
    const result = parseRoutePath('users/[id]/page.tsx')
    expect(result.segments).toEqual([
      { segment: 'users', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'id', isDynamic: true, isOptional: false, isCatchAll: false }
    ])
  })

  it('should parse catch-all routes', () => {
    const result = parseRoutePath('blog/[...slug]/page.tsx')
    expect(result.segments).toEqual([
      { segment: 'blog', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'slug', isDynamic: true, isOptional: false, isCatchAll: true }
    ])
  })

  it('should parse optional catch-all routes', () => {
    const result = parseRoutePath('docs/[[...slug]]/page.tsx')
    expect(result.segments).toEqual([
      { segment: 'docs', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'slug', isDynamic: true, isOptional: true, isCatchAll: true }
    ])
  })

  it('should parse root page', () => {
    const result = parseRoutePath('page.tsx')
    expect(result.segments).toEqual([])
    expect(result.type).toBe('page')
  })

  it('should identify layout files', () => {
    const result = parseRoutePath('about/layout.tsx')
    expect(result.type).toBe('layout')
  })
})

describe('matchRoute', () => {
  it('should match static routes', () => {
    const segments = [
      { segment: 'about', isDynamic: false, isOptional: false, isCatchAll: false }
    ]
    const result = matchRoute('/about', segments)
    expect(result.matches).toBe(true)
    expect(result.params).toEqual({})
  })

  it('should match dynamic routes', () => {
    const segments = [
      { segment: 'users', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'id', isDynamic: true, isOptional: false, isCatchAll: false }
    ]
    const result = matchRoute('/users/123', segments)
    expect(result.matches).toBe(true)
    expect(result.params).toEqual({ id: '123' })
  })

  it('should match catch-all routes', () => {
    const segments = [
      { segment: 'blog', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'slug', isDynamic: true, isOptional: false, isCatchAll: true }
    ]
    const result = matchRoute('/blog/2024/01/hello-world', segments)
    expect(result.matches).toBe(true)
    expect(result.params).toEqual({ slug: '2024/01/hello-world' })
  })

  it('should match optional catch-all routes with no params', () => {
    const segments = [
      { segment: 'docs', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'slug', isDynamic: true, isOptional: true, isCatchAll: true }
    ]
    const result = matchRoute('/docs', segments)
    expect(result.matches).toBe(true)
    expect(result.params).toEqual({ slug: '' })
  })

  it('should not match incorrect routes', () => {
    const segments = [
      { segment: 'about', isDynamic: false, isOptional: false, isCatchAll: false }
    ]
    const result = matchRoute('/contact', segments)
    expect(result.matches).toBe(false)
  })

  it('should match root route', () => {
    const result = matchRoute('/', [])
    expect(result.matches).toBe(true)
    expect(result.params).toEqual({})
  })
})

describe('segmentsToPattern', () => {
  it('should convert static segments to pattern', () => {
    const segments = [
      { segment: 'about', isDynamic: false, isOptional: false, isCatchAll: false }
    ]
    const pattern = segmentsToPattern(segments)
    expect(pattern).toBe('/about')
  })

  it('should convert dynamic segments to pattern', () => {
    const segments = [
      { segment: 'users', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'id', isDynamic: true, isOptional: false, isCatchAll: false }
    ]
    const pattern = segmentsToPattern(segments)
    expect(pattern).toBe('/users/:id')
  })

  it('should convert catch-all segments to pattern', () => {
    const segments = [
      { segment: 'blog', isDynamic: false, isOptional: false, isCatchAll: false },
      { segment: 'slug', isDynamic: true, isOptional: false, isCatchAll: true }
    ]
    const pattern = segmentsToPattern(segments)
    expect(pattern).toBe('/blog/*slug')
  })

  it('should handle empty segments (root)', () => {
    const pattern = segmentsToPattern([])
    expect(pattern).toBe('/')
  })
})

