import React from 'react';
import type { PageProps } from 'farm';
import { Link } from 'farm/client';

export default function AboutPage({ params, searchParams }: PageProps) {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">About Farm.js</h1>

        <p className="text-xl text-gray-600 leading-relaxed">
          Farm.js is a modern React meta-framework that combines the best of Vite's lightning-fast
          development experience with Next.js-like semantics and React Server Components support.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-3 text-blue-900">Why Farm.js?</h2>
          <p className="text-gray-700 leading-relaxed">
            We built Farm.js to provide developers with a framework that's both powerful and simple.
            No complex configuration, no waiting for builds, just pure development joy with modern
            React features.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg"
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
