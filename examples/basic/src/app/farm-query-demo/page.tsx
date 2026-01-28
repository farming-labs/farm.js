'use client';

import React from 'react';
import {
  useQueryState,
  asString ,
  asArrayOf ,
  asInteger,
  asBoolean,
} from '@farmjs/core/query/client';

function FarmClientQueryDemo() {
  // For search input: Use replaceState to update URL immediately without cluttering history
  // This gives instant feedback while typing
  const [search, setSearch] = useQueryState('search', asString, { 
    history: 'replaceState',
    throttleMs: 150 // Small throttle to avoid too many updates, but still feels instant
  });
  
  // Other fields update immediately
  const [page, setPage] = useQueryState('page', asInteger.withDefault!(1));
  const [category, setCategory] = useQueryState('category', asString.withDefault!('all'));
  const [enabled, setEnabled] = useQueryState('enabled', asBoolean.withDefault!(false));
  const [tags, setTags] = useQueryState('tags', asArrayOf(asString).withDefault!([]));
  const [sortBy, setSortBy] = useQueryState('sortBy', asString.withDefault!('date'));
  const [sortOrder, setSortOrder] = useQueryState('sortOrder', asString.withDefault!('desc'));

  const handleTagAdd = (tag: string) => {
    if (tag && !(tags || []).includes(tag)) {
      setTags([...(tags || []), tag]);
    }
  };

  const handleTagRemove = (tagToRemove: string) => {
    setTags((tags || []).filter(tag => tag !== tagToRemove));
  };

  const clearAll = () => {
    setSearch(null);
    setPage(1);
    setCategory('all');
    setEnabled(false);
    setTags([]);
    setSortBy('date');
    setSortOrder('desc');
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Farm.js Client-Side Query State (nuqs-style)</h3>
      
      {/* Search Input - Auto-updates URL with throttling */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Search:</label>
        <input
          type="text"
          value={search || ''}
          onChange={(e) => {
            console.log({val: e.target.value})
            const newValue = e.target.value || null;
            setSearch(newValue);
          }}
          placeholder="Type to search... (UI updates instantly, URL updates after 300ms)"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          ✨ UI updates instantly • URL updates after you stop typing (300ms delay)
        </p>
      </div>

      {/* Page Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Page:</label>
        <input
          type="number"
          value={page || 1}
          onChange={(e) => setPage(e.target.value ? parseInt(e.target.value) || 1 : 1)}
          min="1"
          className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Category Select */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Category:</label>
        <select
          value={category || 'all'}
          onChange={(e) => setCategory(e.target.value || null)}
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
            checked={enabled || false}
            onChange={(e) => setEnabled(e.target.checked)}
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
            value={sortBy || 'date'}
            onChange={(e) => setSortBy(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="date">Date</option>
            <option value="name">Name</option>
            <option value="price">Price</option>
          </select>
          <select
            value={sortOrder || 'desc'}
            onChange={(e) => setSortOrder(e.target.value || null)}
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
          {(tags || []).map((tag) => (
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
          placeholder="Add tag (press Enter)..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const newTag = e.currentTarget.value.trim();
              if (newTag) {
                handleTagAdd(newTag);
                e.currentTarget.value = '';
              }
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
          {JSON.stringify({
            search: search || null,
            page: page || 1,
            category: category || 'all',
            enabled: enabled || false,
            tags: tags || [],
            sortBy: sortBy || 'date',
            sortOrder: sortOrder || 'desc',
          }, null, 2)}
        </pre>
        <div className="mt-2">
          <p className="text-xs text-gray-500">Current URL:</p>
          <code className="text-xs text-blue-600 break-all">
            {typeof window !== 'undefined' ? window.location.href : ''}
          </code>
        </div>
      </div>
    </div>
  );
}

// Main page component
export default function FarmQueryDemoPage(props) {
  console.log({props})
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Farm.js Query State Demo
          </h1>
          <p className="text-gray-600">
            Type-safe URL search parameter state management using Farm.js query utilities
          </p>
        </div>

        {/* Middleware Data Demo */}
        {/* <MiddlewareDataDemo middleware={props.middleware} />

        {/* Server Component Demo */}
        {/* <FarmServerQueryDemo {...props} /> */}
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
                <li><code>parseAsString</code> - String values</li>
                <li><code>parseAsInteger</code> - Integer numbers</li>
                <li><code>parseAsFloat</code> - Float numbers</li>
                <li><code>parseAsBoolean</code> - Boolean values</li>
                <li><code>parseAsArrayOf(parser)</code> - Arrays of any type</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
