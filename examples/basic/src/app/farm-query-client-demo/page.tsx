'use client';

import React, { useEffect, useState } from 'react';
import {
  useQueryState,
  asString,
  asInteger,
  asBoolean,
  asArrayOf,
} from '@farmjs/core/query/client';
export default function FarmClientQueryDemo() {
  const [search, setSearch] = useQueryState('search', asString);
  const [page, setPage] = useQueryState('page', asInteger.withDefault!(1));
  const [category, setCategory] = useQueryState('category', asString.withDefault!('all'));
  const [enabled, setEnabled] = useQueryState('enabled', asBoolean.withDefault!(false));
  const [tags, setTags] = useQueryState('tags', asArrayOf(asString).withDefault!([]));
  const [sortBy, setSortBy] = useQueryState('sortBy', asString.withDefault!('date'));
  const [sortOrder, setSortOrder] = useQueryState('sortOrder', asString.withDefault!('desc'));
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    setCurrentUrl(window.location.href);
  });
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
            {currentUrl}
          </code>
        </div>
      </div>
    </div>
  );
}
