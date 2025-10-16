'use client';

import React, { useState } from 'react';
import { api } from '../../lib/api-client';

export default function APIClientDemo() {
  const [helloResponse, setHelloResponse] = useState<any>(null);
  const [usersResponse, setUsersResponse] = useState<any>(null);
  const [loginResponse, setLoginResponse] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHello = async () => {
    setLoading('hello');
    setError(null);
    try {
       const data = await api.hello.post({
            body: { name: 'something' }
      });
      console.log("Result from api client: " , {data})
      setHelloResponse(data);
    } catch (err) {
      setError('Failed to fetch hello endpoint: ' + err);
    } finally {
      setLoading(null);
    }
  };

  // Fetch users endpoint using nested API syntax
  const fetchUsers = async () => {
    setLoading('users');
    setError(null);
    try {
      // Nested API call: api.users.get()
      const data = await api.users.get({
        query: { limit: '5' }
      });
      setUsersResponse(data);
    } catch (err) {
      setError('Failed to fetch users: ' + err);
    } finally {
      setLoading(null);
    }
  };

  // Login using nested API syntax
  const handleLogin = async () => {
    setLoading('login');
    setError(null);
    try {
      // Nested API call: api.auth.login.post()
      const data = await api.auth.login.post({
        body: {
            email: "test@example.com",
            password: "password123"
        } 
      });
      setLoginResponse(data);
    } catch (err) {
      setError('Failed to login: ' + err);
    } finally {
      setLoading(null);
    }
  };

  // Create new user using nested API syntax
  const createUser = async () => {
    setLoading('create');
    setError(null);
    try {
      // Nested API call: api.users.post()
      const data = await api.users.post({
      });
      alert('User created! ' + JSON.stringify(data));
      // Refresh users list
      await fetchUsers();
    } catch (err) {
      setError('Failed to create user: ' + err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-800 to-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-pink-400 to-yellow-400 bg-clip-text text-transparent">
          Client Component API Demo 🎨
        </h1>
        
        <div className="bg-pink-900/30 border border-pink-500/50 rounded-lg p-4 mb-8">
          <p className="text-pink-200 text-sm">
            <strong>'use client'</strong> - This is a client component! All API calls happen in the browser.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-200">❌ {error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Hello API */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-blue-400">
              GET /api/hello
            </h2>
            <button
              onClick={fetchHello}
              disabled={loading === 'hello'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {loading === 'hello' ? 'Loading...' : 'Fetch'}
            </button>
            
            {helloResponse && (
              <div className="bg-gray-900 rounded p-4 font-mono text-sm">
                <pre className="text-green-400">
                  {JSON.stringify(helloResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Users API */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-purple-400">
              GET /api/users
            </h2>
            <button
              onClick={fetchUsers}
              disabled={loading === 'users'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {loading === 'users' ? 'Loading...' : 'Fetch Users'}
            </button>
            
            {usersResponse && (
              <div className="bg-gray-900 rounded p-4 font-mono text-sm">
                <pre className="text-green-400">
                  {JSON.stringify(usersResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Login API (POST) */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-yellow-400">
              POST /api/auth/login
            </h2>
            <button
              onClick={handleLogin}
              disabled={loading === 'login'}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {loading === 'login' ? 'Logging in...' : 'Login'}
            </button>
            
            {loginResponse && (
              <div className="bg-gray-900 rounded p-4 font-mono text-sm">
                <pre className="text-green-400">
                  {JSON.stringify(loginResponse, null, 2)}
                </pre>
              </div>
            )}
            
            <p className="text-sm text-gray-400 mt-2">
              Credentials: email: <code className="bg-gray-700 px-1">test@example.com</code>, 
              password: <code className="bg-gray-700 px-1">password123</code>
            </p>
          </div>

          {/* Create User (POST) */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-green-400">
              POST /api/users
            </h2>
            <button
              onClick={createUser}
              disabled={loading === 'create'}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {loading === 'create' ? 'Creating...' : 'Create New User'}
            </button>
            
            <p className="text-sm text-gray-400">
              Creates a new user and refreshes the users list
            </p>
          </div>

          {/* Code Example */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-cyan-400">
              Type-Safe API Client Examples
            </h2>
            <div className="bg-gray-900 rounded p-4 font-mono text-xs space-y-4">
              <div>
                <p className="text-gray-500 mb-2">// Import the typed client</p>
                <pre className="text-gray-300">
{`import { client, api } from '@/lib/api-client';`}
                </pre>
              </div>
              
              <div>
                <p className="text-gray-500 mb-2">// Option 1: Direct client call</p>
                <pre className="text-gray-300">
{`const result = await client('/api/hello', {
  query: { name: 'World' }
});`}
                </pre>
              </div>
              
              <div>
                <p className="text-gray-500 mb-2">// Option 2: Nested API syntax (recommended!)</p>
                <pre className="text-yellow-300">
{`const result = await api.auth.login({
  body: {
    email: 'test@example.com',
    password: 'password123'
  }
});

console.log(result.token); // ✅ Fully typed!
console.log(result.user);  // ✅ Autocomplete works!`}
                </pre>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex gap-4 justify-center pt-8">
            <a 
              href="/api-demo" 
              className="inline-block px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors"
            >
              Server Component Demo
            </a>
            <a 
              href="/" 
              className="inline-block px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-colors"
            >
              ← Back to Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
