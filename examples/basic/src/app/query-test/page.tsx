import React from 'react';
import type { PageProps } from 'farm';

// Simple test page to demonstrate query state functionality
export default async function QueryTestPage({ searchParams }: PageProps) {
  const params = await searchParams;
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Query State Test Page
        </h1>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Server-Side Query Parameters</h2>
          
          <div className="space-y-2">
            <p><strong>All Parameters:</strong></p>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
          
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Test Links</h3>
            <div className="space-y-2">
              <a 
                href="/query-test?name=John&age=25&city=New York" 
                className="block text-blue-600 hover:text-blue-800 underline"
              >
                Test with name=John, age=25, city=New York
              </a>
              <a 
                href="/query-test?search=react&page=3&category=tech&enabled=true" 
                className="block text-blue-600 hover:text-blue-800 underline"
              >
                Test with search=react, page=3, category=tech, enabled=true
              </a>
              <a 
                href="/query-test?tags=javascript,typescript,react&sort=date&order=desc" 
                className="block text-blue-600 hover:text-blue-800 underline"
              >
                Test with tags=javascript,typescript,react, sort=date, order=desc
              </a>
            </div>
          </div>
          
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Current URL</h3>
            <p className="text-sm text-gray-600 break-all">
              {typeof window !== 'undefined' ? window.location.href : 'Server-side rendering'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
