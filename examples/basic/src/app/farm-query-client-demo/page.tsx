'use client';

import React, { useState } from 'react';
import {
  useQueryState,
  useQueryStates,
  parseAsString,
  parseAsInteger,
  parseAsFloat,
  parseAsBoolean,
  parseAsArrayOf,
  parseAsJson,
  parseAsIsoDate,
  createParser,
  usePagination,
  useSearchFilters,
} from 'farm/query/client';

const parseAsColor = createParser({
  parse: (value: string) => {
    const validColors = ['red', 'blue', 'green', 'yellow', 'purple'];
    return validColors.includes(value) ? value : null;
  },
  serialize: (value: string) => value,
});

function FarmClientQueryDemo() {
  const [search, setSearch] = useQueryState('search', parseAsString);
  const [count, setCount] = useQueryState('count', parseAsInteger.withDefault!(0));
  const [price, setPrice] = useQueryState('price', parseAsFloat);
  const [enabled, setEnabled] = useQueryState('enabled', parseAsBoolean.withDefault!(false));
  const [color, setColor] = useQueryState('color', parseAsColor);
  const [date, setDate] = useQueryState('date', parseAsIsoDate);
  const [tags, setTags] = useQueryState('tags', parseAsArrayOf(parseAsString).withDefault!([]));

  // JSON parser example
  const filtersParser = createParser<{ category: string; sort: string }>({
    parse: (value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    },
    serialize: (value: { category: string; sort: string }) => JSON.stringify(value),
  });
  const [filters, setFilters] = useQueryState('filters', filtersParser);

  // useQueryStates example
  const [multiState, setMultiState] = useQueryStates({
    name: parseAsString,
    age: parseAsInteger,
    active: parseAsBoolean.withDefault!(true),
  });

  // usePagination hook
  const pagination = usePagination({
    defaultPage: 1,
    defaultLimit: 10,
  });

  // useSearchFilters hook
  const searchFilters = useSearchFilters({
    searchKey: 'q',
    defaultFilters: { category: 'all', sort: 'name' },
  });

  // Local state for JSON editor
  const [jsonInput, setJsonInput] = useState('{"category": "tech", "sort": "date"}');

  const handleJsonUpdate = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      setFilters(parsed);
    } catch (error) {
      alert('Invalid JSON');
    }
  };

  const clearAll = () => {
    setSearch(null);
    setCount(0);
    setPrice(null);
    setEnabled(false);
    setColor(null);
    setDate(null);
    setTags([]);
    setFilters(null);
    setMultiState({ name: null, age: null, active: true });
    pagination.resetPagination();
    searchFilters.clearFilters();
    window.history.pushState({}, '', window.location.pathname);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Farm.js Client Query Demo
          </h1>
          <p className="text-gray-600">
            Type-safe URL query parameter management - Like useState, but stored in the URL
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Basic useQueryState Examples */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Basic useQueryState Examples</h3>
            
            <div className="space-y-4">
              {/* Search */}
              <div>
                <label className="block text-sm font-medium mb-2">Search:</label>
                <input
                  type="text"
                  value={search || ''}
                  onChange={(e) => setSearch(e.target.value || null)}
                  placeholder="Enter search term..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Count */}
              <div>
                <label className="block text-sm font-medium mb-2">Count: {count}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCount((count || 0) - 1)}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    -
                  </button>
                  <button
                    onClick={() => setCount((count || 0) + 1)}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Price */}
              <div>
                <label className="block text-sm font-medium mb-2">Price:</label>
                <input
                  type="number"
                  step="0.01"
                  value={price || ''}
                  onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : null)}
                  placeholder="Enter price..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Enabled */}
              <div>
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

              {/* Color */}
              <div>
                <label className="block text-sm font-medium mb-2">Color:</label>
                <select
                  value={color || ''}
                  onChange={(e) => setColor(e.target.value || null)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select color</option>
                  <option value="red">Red</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="yellow">Yellow</option>
                  <option value="purple">Purple</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium mb-2">Date:</label>
                <input
                  type="date"
                  value={date ? date.toISOString().split('T')[0] : ''}
                  onChange={(e) => setDate(e.target.value ? new Date(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium mb-2">Tags:</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {(tags || []).map((tag, index) => (
                    <span key={index} className="flex items-center bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full">
                      {tag}
                      <button
                        onClick={() => setTags((tags || []).filter((_, i) => i !== index))}
                        className="ml-1 text-blue-600 hover:text-blue-900"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Add tag..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const newTag = (e.target as HTMLInputElement).value.trim();
                      if (newTag && !(tags || []).includes(newTag)) {
                        setTags([...(tags || []), newTag]);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Advanced Examples */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Advanced Examples</h3>
            
            <div className="space-y-4">
              {/* JSON Parser */}
              <div>
                <label className="block text-sm font-medium mb-2">JSON Filters:</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleJsonUpdate}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Update
                  </button>
                </div>
                <pre className="bg-gray-100 p-2 rounded text-xs">
                  {JSON.stringify(filters, null, 2)}
                </pre>
              </div>

              {/* useQueryStates */}
              <div>
                <label className="block text-sm font-medium mb-2">Multi State:</label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={multiState.name || ''}
                    onChange={(e) => setMultiState({ ...multiState, name: e.target.value || null })}
                    placeholder="Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={multiState.age || ''}
                    onChange={(e) => setMultiState({ ...multiState, age: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Age"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={multiState.active || false}
                      onChange={(e) => setMultiState({ ...multiState, active: e.target.checked })}
                      className="mr-2"
                    />
                    <span className="text-sm">Active</span>
                  </label>
                </div>
              </div>

              {/* Pagination */}
              <div>
                <label className="block text-sm font-medium mb-2">Pagination:</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => pagination.setPage(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span>Page {pagination.page} of 10</span>
                  <button
                    onClick={() => pagination.setPage(pagination.page + 1)}
                    disabled={pagination.page >= 10}
                    className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                  >
                    Next
                  </button>
                  <select
                    value={pagination.limit}
                    onChange={(e) => pagination.setLimit(parseInt(e.target.value))}
                    className="px-2 py-1 border border-gray-300 rounded"
                  >
                    <option value={5}>5 per page</option>
                    <option value={10}>10 per page</option>
                    <option value={20}>20 per page</option>
                  </select>
                </div>
              </div>

              {/* Search Filters */}
              <div>
                <label className="block text-sm font-medium mb-2">Search Filters:</label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={searchFilters.search || ''}
                    onChange={(e) => searchFilters.setSearch(e.target.value || null)}
                    placeholder="Search..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <select
                      value={searchFilters.filters.category || 'all'}
                      onChange={(e) => searchFilters.setFilters({ ...searchFilters.filters, category: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Categories</option>
                      <option value="tech">Technology</option>
                      <option value="business">Business</option>
                      <option value="lifestyle">Lifestyle</option>
                    </select>
                    <select
                      value={searchFilters.filters.sort || 'name'}
                      onChange={(e) => searchFilters.setFilters({ ...searchFilters.filters, sort: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="name">Sort by Name</option>
                      <option value="date">Sort by Date</option>
                      <option value="price">Sort by Price</option>
                    </select>
                  </div>
                  <button
                    onClick={searchFilters.clearFilters}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current State Display */}
        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Current URL State</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">Basic State:</h4>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify({
                  search,
                  count,
                  price,
                  enabled,
                  color,
                  date: date?.toISOString(),
                  tags,
                  filters,
                }, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-2">Advanced State:</h4>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify({
                  multiState,
                  pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    offset: pagination.offset,
                  },
                  searchFilters: {
                    search: searchFilters.search,
                    filters: searchFilters.filters,
                  },
                }, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-4">
          <button
            onClick={clearAll}
            className="px-6 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Clear All State
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Reload Page
          </button>
        </div>

        {/* URL Display */}
        <div className="mt-6 bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Current URL:</h4>
          <code className="text-sm text-blue-800 break-all">
            {typeof window !== 'undefined' ? window.location.href : ''}
          </code>
        </div>
      </div>
    </div>
  );
}

export default FarmClientQueryDemo;