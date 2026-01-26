import React from "react";
import type { PagePropsSafe } from "farm/query";
import {
  loadSearchParams,
  parseAsString,
  parseAsInteger,
  parseAsBoolean,
  parseAsArrayOf,
  type SearchParams,
} from "farm/query/server";

// Server Component - demonstrates Farm.js server-side query state
async function FarmServerQueryDemo({ searchParams }: PagePropsSafe) {
  const params = await loadSearchParams(searchParams, {
    search: parseAsString.withDefault!(""),
    page: parseAsInteger.withDefault!(1),
    category: parseAsString.withDefault!("all"),
    enabled: parseAsBoolean.withDefault!(false),
    tags: parseAsArrayOf(parseAsString).withDefault!([]),
    sortBy: parseAsString.withDefault!("date"),
    sortOrder: parseAsString.withDefault!("desc"),
  });
  console.log({ params });
  return (
    <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg mb-6">
      <h3 className="text-lg font-semibold mb-4 text-blue-800">Farm.js Server-Side Query State</h3>
      <div className="space-y-2 text-sm">
        <p>
          <strong>Search:</strong> {params.search || "None"}
        </p>
        <p>
          <strong>Page:</strong> {params.page}
        </p>
        <p>
          <strong>Category:</strong> {params.category}
        </p>
        <p>
          <strong>Enabled:</strong> {params.enabled ? "Yes" : "No"}
        </p>
        <p>
          <strong>Tags:</strong> {params.tags.length > 0 ? params.tags.join(", ") : "None"}
        </p>
        <p>
          <strong>Sort By:</strong> {params.sortBy}
        </p>
        <p>
          <strong>Sort Order:</strong> {params.sortOrder}
        </p>

        <div className="mt-4">
          <p>
            <strong>Type-Safe Parsed Parameters:</strong>
          </p>
          <pre className="bg-blue-100 p-3 rounded text-xs overflow-x-auto mt-2">
            {JSON.stringify(params, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Client Component - demonstrates Farm.js client-side query state
("use client");

import { useState, useEffect } from "react";

function FarmClientQueryDemo() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("all");
  const [enabled, setEnabled] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");

  // Load initial values from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setSearch(urlParams.get("search") || "");
    setPage(parseInt(urlParams.get("page") || "1"));
    setCategory(urlParams.get("category") || "all");
    setEnabled(urlParams.get("enabled") === "true");
    setTags(urlParams.get("tags")?.split(",").filter(Boolean) || []);
    setSortBy(urlParams.get("sortBy") || "date");
    setSortOrder(urlParams.get("sortOrder") || "desc");
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
    updateURL({ search: value, page, category, enabled, tags, sortBy, sortOrder });
  };

  const handlePageChange = (value: number) => {
    setPage(value);
    updateURL({ search, page: value, category, enabled, tags, sortBy, sortOrder });
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    updateURL({ search, page, category: value, enabled, tags, sortBy, sortOrder });
  };

  const handleEnabledChange = (value: boolean) => {
    setEnabled(value);
    updateURL({ search, page, category, enabled: value, tags, sortBy, sortOrder });
  };

  const handleTagAdd = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      updateURL({ search, page, category, enabled, tags: newTags, sortBy, sortOrder });
    }
  };

  const handleTagRemove = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    updateURL({ search, page, category, enabled, tags: newTags, sortBy, sortOrder });
  };

  const handleSortChange = (by: string, order: string) => {
    setSortBy(by);
    setSortOrder(order);
    updateURL({ search, page, category, enabled, tags, sortBy: by, sortOrder: order });
  };

  const clearAll = () => {
    setSearch("");
    setPage(1);
    setCategory("all");
    setEnabled(false);
    setTags([]);
    setSortBy("date");
    setSortOrder("desc");
    window.history.pushState({}, "", window.location.pathname);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Farm.js Client-Side Query State</h3>

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
          <option value="all">All Categories</option>
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

      {/* Sort Controls */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Sort:</label>
        <div className="flex gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value, sortOrder)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="date">Date</option>
            <option value="name">Name</option>
            <option value="price">Price</option>
          </select>
          <select
            value={sortOrder}
            onChange={(e) => handleSortChange(sortBy, e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
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
              sortBy,
              sortOrder,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}

// Main page component
export default async function FarmQueryDemoPage(props: PageProps) {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Farm.js Query State Demo</h1>
          <p className="text-gray-600">
            Type-safe URL search parameter state management using Farm.js query utilities
          </p>
        </div>

        {/* Middleware Data Demo */}
        <MiddlewareDataDemo middleware={props.middleware} />

        {/* Server Component Demo */}
        <FarmServerQueryDemo {...props} />

        {/* Client Component Demo */}
        <FarmClientQueryDemo />

        {/* Documentation */}
        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Farm.js Query Usage Examples</h3>
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium">Server Components:</h4>
              <pre className="bg-gray-100 p-3 rounded mt-2 overflow-x-auto">
                {`import { 
  loadSearchParams,
  parseAsString,
  parseAsInteger,
  parseAsBoolean,
  parseAsArrayOf
} from 'farm/query/server';

export default async function MyPage({ searchParams }: PageProps) {
  const params = await loadSearchParams(searchParams, {
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    enabled: parseAsBoolean.withDefault(false),
    tags: parseAsArrayOf(parseAsString).withDefault([]),
  });
  
  return <div>Search: {params.search}, Page: {params.page}</div>;
}`}
              </pre>
            </div>

            <div>
              <h4 className="font-medium">Available Parsers:</h4>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>
                  <code>parseAsString</code> - String values
                </li>
                <li>
                  <code>parseAsInteger</code> - Integer numbers
                </li>
                <li>
                  <code>parseAsFloat</code> - Float numbers
                </li>
                <li>
                  <code>parseAsBoolean</code> - Boolean values
                </li>
                <li>
                  <code>parseAsArrayOf(parser)</code> - Arrays of any type
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
