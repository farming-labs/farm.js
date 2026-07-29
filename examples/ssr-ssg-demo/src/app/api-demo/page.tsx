"use client";

import { useState } from "react";

export const metadata = {
  title: "API Demo - Farm.js",
  description: "Demonstrating API routes with typed endpoints",
};

export default function ApiDemoPage() {
  const [helloResult, setHelloResult] = useState<any>(null);
  const [usersResult, setUsersResult] = useState<any>(null);
  const [postResult, setPostResult] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const fetchHello = async (name?: string) => {
    setLoading("hello");
    try {
      const url = name ? `/api/hello?name=${encodeURIComponent(name)}` : "/api/hello";
      const res = await fetch(url);
      const data = await res.json();
      setHelloResult(data);
    } catch (error) {
      setHelloResult({ error: String(error) });
    }
    setLoading(null);
  };

  const fetchUsers = async (role?: string) => {
    setLoading("users");
    try {
      const url = role ? `/api/users?role=${role}` : "/api/users";
      const res = await fetch(url);
      const data = await res.json();
      setUsersResult(data);
    } catch (error) {
      setUsersResult({ error: String(error) });
    }
    setLoading(null);
  };

  const createUser = async () => {
    setLoading("post");
    try {
      const res = await fetch("/api/hello", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New User", email: "new@example.com" }),
      });
      const data = await res.json();
      setPostResult(data);
    } catch (error) {
      setPostResult({ error: String(error) });
    }
    setLoading(null);
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium">
            API Routes
          </span>
          <span className="text-gray-500">Type-safe endpoints</span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">API Demo</h1>
        <p className="text-gray-600 mb-6">
          Farm.js provides type-safe API routes with Zod validation. Click the buttons below to test the endpoints.
        </p>
      </div>

      {/* Hello API */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">GET /api/hello</h2>
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => fetchHello()}
            disabled={loading === "hello"}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading === "hello" ? "Loading..." : "Call without name"}
          </button>
          <button
            onClick={() => fetchHello("Farm.js User")}
            disabled={loading === "hello"}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading === "hello" ? "Loading..." : "Call with name"}
          </button>
        </div>
        {helloResult && (
          <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
            {JSON.stringify(helloResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Users API */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">GET /api/users</h2>
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => fetchUsers()}
            disabled={loading === "users"}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading === "users" ? "Loading..." : "Get all users"}
          </button>
          <button
            onClick={() => fetchUsers("admin")}
            disabled={loading === "users"}
            className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
          >
            {loading === "users" ? "Loading..." : "Get admins only"}
          </button>
        </div>
        {usersResult && (
          <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
            {JSON.stringify(usersResult, null, 2)}
          </pre>
        )}
      </div>

      {/* POST API */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">POST /api/hello</h2>
        <button
          onClick={createUser}
          disabled={loading === "post"}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 mb-4"
        >
          {loading === "post" ? "Loading..." : "Send POST request"}
        </button>
        {postResult && (
          <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
            {JSON.stringify(postResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Code Example */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">API Route Code</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`// src/app/api/hello/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  {
    method: "GET",
    query: z.object({
      name: z.string().optional(),
    }),
  },
  async ({ query }) => {
    return {
      message: \`Hello, \${query.name || "World"}!\`,
      timestamp: new Date().toISOString(),
    };
  },
);`}
        </pre>
      </div>
    </div>
  );
}
