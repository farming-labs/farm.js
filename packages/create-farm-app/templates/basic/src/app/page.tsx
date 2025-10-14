import React from 'react';
import type { PageProps } from 'farm';
import { Link } from 'farm/client';

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <div>
          <h1 className="text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              🚜 Welcome to Farm.js
            </span>
          </h1>

          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            A modern React meta-framework built on Vite with Next.js-like semantics
          </p>
        </div>

        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            href="/about"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg"
          >
            About Page
          </Link>

          <a
            href="https://farm.js.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium"
          >
            Documentation
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-8 text-left">
          <h2 className="text-2xl font-bold mb-6 text-gray-900">Features</h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="text-2xl">🚀</span>
              <span className="text-gray-700">Blazing fast development with Vite</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-2xl">⚛️</span>
              <span className="text-gray-700">React Server Components support</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-2xl">🎯</span>
              <span className="text-gray-700">Next.js-like file-based routing</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-2xl">🎨</span>
              <span className="text-gray-700">Tailwind CSS built-in</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-2xl">📦</span>
              <span className="text-gray-700">Zero configuration setup</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-2xl">🧪</span>
              <span className="text-gray-700">AI-friendly code structure</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
