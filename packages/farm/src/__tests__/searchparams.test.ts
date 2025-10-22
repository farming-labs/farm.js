import { describe, it, expect } from 'vitest';

describe('SearchParams Parsing', () => {
  it('should parse single query parameter', () => {
    const urlSearchParams = new URLSearchParams('?tab=profile');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({ tab: 'profile' });
  });

  it('should parse multiple query parameters', () => {
    const urlSearchParams = new URLSearchParams('?tab=profile&sort=desc&page=2');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({
      tab: 'profile',
      sort: 'desc',
      page: '2',
    });
  });

  it('should handle duplicate query parameters as array', () => {
    const urlSearchParams = new URLSearchParams('?tag=react&tag=typescript&tag=vite');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      const existing = result[key];
      if (existing) {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          result[key] = [existing, value];
        }
      } else {
        result[key] = value;
      }
    });
    
    expect(result).toEqual({
      tag: ['react', 'typescript', 'vite'],
    });
  });

  it('should handle URL-encoded values', () => {
    const urlSearchParams = new URLSearchParams('?name=John%20Doe&email=john%40example.com');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should handle empty searchParams', () => {
    const urlSearchParams = new URLSearchParams('');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({});
  });

  it('should handle parameters with empty values', () => {
    const urlSearchParams = new URLSearchParams('?tab=&sort=desc');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({
      tab: '',
      sort: 'desc',
    });
  });

  it('should handle special characters', () => {
    const urlSearchParams = new URLSearchParams('?search=hello+world&filter=price>100');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({
      search: 'hello world',
      filter: 'price>100',
    });
  });

  it('should handle numeric values as strings', () => {
    const urlSearchParams = new URLSearchParams('?page=1&limit=10&price=99.99');
    const result: Record<string, string | string[] | undefined> = {};
    
    urlSearchParams.forEach((value, key) => {
      result[key] = value;
    });
    
    expect(result).toEqual({
      page: '1',
      limit: '10',
      price: '99.99',
    });
  });
});

describe('SearchParams in PageProps', () => {
  it('should provide searchParams as a Promise', async () => {
    const searchParams: Promise<Record<string, string | string[] | undefined>> = Promise.resolve({
      tab: 'profile',
      sort: 'desc',
    });

    const result = await searchParams;
    
    expect(result).toEqual({
      tab: 'profile',
      sort: 'desc',
    });
  });

  it('should allow destructuring after await', async () => {
    const searchParams = Promise.resolve({
      tab: 'profile',
      sort: 'desc',
      page: '1',
    });

    const search = await searchParams;
    const { tab, sort, page } = search;
    
    expect(tab).toBe('profile');
    expect(sort).toBe('desc');
    expect(page).toBe('1');
  });

  it('should handle missing search params gracefully', async () => {
    const searchParams = Promise.resolve({});
    const search = await searchParams;
    const tab = search.tab;
    
    expect(tab).toBeUndefined();
  });
});

