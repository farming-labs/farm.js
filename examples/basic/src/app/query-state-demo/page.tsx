import React from "react";
import type { PageProps } from "farm";
import { Suspense } from "react";

// Server Component - demonstrates server-side query state
async function ServerQueryStateDemo({ searchParams }: PageProps) {
  // Simple server-side parameter reading
  const params = await searchParams;
  const search = params.search || null;
  const page = parseInt((params.page as string) || "1");
  const category = params.category || null;
  const enabled = params.enabled === "true";
  const tags = params.tags ? (Array.isArray(params.tags) ? params.tags : [params.tags]) : [];

  return (
    <div className="bg-gray-100 p-6 rounded-lg mb-6">
      <h3 className="text-lg font-semibold mb-4">Server-Side Query State</h3>
      <div className="space-y-2 text-sm">
        <p>
          <strong>Search:</strong> {search || "None"}
        </p>
        <p>
          <strong>Page:</strong> {page}
        </p>
        <p>
          <strong>Category:</strong> {category || "All"}
        </p>
        <p>
          <strong>Enabled:</strong> {enabled ? "Yes" : "No"}
        </p>
        <p>
          <strong>Tags:</strong> {tags.length > 0 ? tags.join(", ") : "None"}
        </p>
        <p>
          <strong>All Parameters:</strong>
        </p>
        <pre className="bg-gray-200 p-2 rounded text-xs overflow-x-auto">
          {JSON.stringify(params, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// Client Component - demonstrates client-side query state
("use client");

import { useState, useEffect } from "react";

function ClientQueryStateDemo() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  // Load initial values from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setSearch(urlParams.get("search") || "");
    setPage(parseInt(urlParams.get("page") || "1"));
    setCategory(urlParams.get("category") || "");
    setEnabled(urlParams.get("enabled") === "true");
    setTags(urlParams.get("tags")?.split(",").filter(Boolean) || []);
  }, []);

  // Update URL when state changes
  const updateURL = (newParams: Record<string, string | number | boolean | string[]>) => {
    const url = new URL(window.location.href);
    Object.entries(newParams).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) {
        url.searchParams.delete(key);
      } else if (Array.isArray(value)) {
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    });
    window.history.pushState({}, "", url.toString());
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    updateURL({ search: value, page, category, enabled, tags });
  };

  const handlePageChange = (value: number) => {
    setPage(value);
    updateURL({ search, page: value, category, enabled, tags });
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    updateURL({ search, page, category: value, enabled, tags });
  };

  const handleEnabledChange = (value: boolean) => {
    setEnabled(value);
    updateURL({ search, page, category, enabled: value, tags });
  };

  const handleTagAdd = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      updateURL({ search, page, category, enabled, tags: newTags });
    }
  };

  const handleTagRemove = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    updateURL({ search, page, category, enabled, tags: newTags });
  };

  const clearAll = () => {
    setSearch("");
    setPage(1);
    setCategory("");
    setEnabled(false);
    setTags([]);
    window.history.pushState({}, "", window.location.pathname);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Client-Side Query State</h3>

      {/* Search Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Search:</label>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Enter search term..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Page Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Page:</label>
        <input
          type="number"
          value={page}
          onChange={(e) => handlePageChange(parseInt(e.target.value) || 1)}
          min="1"
          className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Category Select */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Category:</label>
        <select
          value={category}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          <option value="tech">Technology</option>
          <option value="business">Business</option>
          <option value="lifestyle">Lifestyle</option>
        </select>
      </div>

      {/* Enabled Checkbox */}
      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleEnabledChange(e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm font-medium">Enabled</span>
        </label>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Tags:</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
            >
              {tag}
              <button
                onClick={() => handleTagRemove(tag)}
                className="ml-1 text-blue-600 hover:text-blue-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          placeholder="Add tag..."
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              handleTagAdd(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Clear Button */}
      <div className="mb-4">
        <button
          onClick={clearAll}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Clear All
        </button>
      </div>

      {/* Current State Display */}
      <div className="mt-6 p-4 bg-gray-50 rounded-md">
        <h4 className="text-md font-semibold mb-2">Current State:</h4>
        <pre className="text-xs text-gray-600 overflow-x-auto">
          {JSON.stringify(
            {
              search,
              page,
              category,
              enabled,
              tags,
            },
            null,
            2,
          )}
        </pre>
      </div>

      {/* Current URL Display */}
      <div className="mt-4 p-4 bg-blue-50 rounded-md">
        <h4 className="text-md font-semibold mb-2">Current URL:</h4>
        <p className="text-sm text-blue-700 break-all">
          {typeof window !== "undefined" ? window.location.href : "Loading..."}
        </p>
      </div>
    </div>
  );
}

// Main page component
export default async function QueryStateDemoPage({ searchParams }: PageProps) {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Query State Management Demo</h1>
          <p className="text-gray-600">
            Type-safe URL search parameter state management with Farm.js
          </p>
        </div>

        {/* Server Component Demo */}
        <ServerQueryStateDemo searchParams={searchParams} />

        {/* Client Component Demo */}
        <Suspense fallback={<div className="p-4 text-center">Loading client component...</div>}>
          <ClientQueryStateDemo />
        </Suspense>

        {/* Documentation */}
        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Usage Examples</h3>
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium">Server Components:</h4>
              <pre className="bg-gray-100 p-3 rounded mt-2 overflow-x-auto">
                {`// In a server component
import type { PageProps } from 'farm';

export default async function MyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search || null;
  const page = parseInt(params.page as string || '1');
  
  return <div>Search: {search}, Page: {page}</div>;
}`}
              </pre>
            </div>

            <div>
              <h4 className="font-medium">Client Components:</h4>
              <pre className="bg-gray-100 p-3 rounded mt-2 overflow-x-auto">
                {`'use client';
import { useState, useEffect } from 'react';

export default function MyComponent() {
  const [search, setSearch] = useState('');
  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setSearch(urlParams.get('search') || '');
  }, []);
  
  const updateURL = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('search', value);
    window.history.pushState({}, '', url.toString());
  };
  
  return (
    <input 
      value={search}
      onChange={(e) => {
        setSearch(e.target.value);
        updateURL(e.target.value);
      }}
    />
  );
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
