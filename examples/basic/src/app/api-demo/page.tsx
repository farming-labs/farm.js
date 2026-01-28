"use client";

import React from 'react';
import { Link } from '@farmjs/core/client';
import { GET as helloGet } from "../api/hello/route"
export default async function APIDemo() {
  const baseURL = 'http://localhost:3000';
  console.log({process: process.env})
  let helloResponse;
  let usersResponse;
  try {
    const helloRes = await helloGet({
      query: {
        name: 'wonderfull something'
      }
    })
    console.log({helloRes})
    helloResponse = helloRes
  } catch (error) {
    helloResponse = { message: 'Error fetching data', timestamp: new Date().toISOString() };
  }
  
  try {
    const usersRes = await fetch(`${baseURL}/api/users`);
    usersResponse = await usersRes.json();
} 
  catch (error) {
    usersResponse = { users: [], total: 0, limit: 10, offset: 0 };
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold mb-8 bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
          API Routes Demo 🚀
        </h1>

        <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-4 mb-8">
          <p className="text-yellow-200 text-sm">
            ⚡ <strong>Live Data!</strong> This page fetches real data from API endpoints using async server components with streaming SSR.
          </p>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-blue-400">
              GET /api/hello
            </h2>
            <div className="bg-gray-900 rounded p-4 font-mono text-sm">
              <pre className="text-green-400">
                {JSON.stringify(helloResponse, null, 2)}
              </pre>
            </div>
            <p className="mt-4 text-gray-400 text-sm">
              ✅ Fetched in async server component: <code className="bg-gray-700 px-2 py-1 rounded">await fetch('/api/hello?name=Farm.js')</code>
            </p>
          </div>

          {/* Users API Response */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-purple-400">
              GET /api/users
            </h2>
            <div className="bg-gray-900 rounded p-4 font-mono text-sm">
              <pre className="text-green-400">
                {JSON.stringify(usersResponse, null, 2)}
              </pre>
            </div>
            <p className="mt-4 text-gray-400 text-sm">
              ✅ Fetched in async server component: <code className="bg-gray-700 px-2 py-1 rounded">await fetch('/api/users')</code>
            </p>
          </div>

          {/* HTTP Endpoints Info */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-yellow-400">
              Available HTTP Endpoints
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="bg-green-600 px-2 py-1 rounded font-mono text-xs">GET</span>
                <code className="text-gray-300">/api/hello?name=YourName</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-green-600 px-2 py-1 rounded font-mono text-xs">GET</span>
                <code className="text-gray-300">/api/users</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-blue-600 px-2 py-1 rounded font-mono text-xs">POST</span>
                <code className="text-gray-300">/api/users</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-green-600 px-2 py-1 rounded font-mono text-xs">GET</span>
                <code className="text-gray-300">/api/auth/login?token=xxx</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-blue-600 px-2 py-1 rounded font-mono text-xs">POST</span>
                <code className="text-gray-300">/api/auth/login</code>
              </div>
            </div>
            <p className="mt-4 text-gray-400 text-sm">
              💡 Test these endpoints with curl or from your browser!
            </p>
          </div>

          {/* Code Example */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-green-400">
              Example: POST Request
            </h2>
            <div className="bg-gray-900 rounded p-4 font-mono text-xs">
              <pre className="text-gray-300">
{`curl -X POST 'http://localhost:3000/api/auth/login' \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"test@example.com","password":"password123"}'

Response:
{
  "success": true,
  "token": "mock-jwt-token-1760530386770",
  "user": {
    "id": "1",
    "email": "test@example.com",
    "name": "Test User"
  }
}`}
              </pre>
            </div>
          </div>

          {/* Back Link */}
          <div className="text-center pt-8">
            <Link 
              href="/" 
              className="inline-block px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
