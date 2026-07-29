'use client';

import React, { useMemo, useState } from 'react';
import { Link } from '@farm.js/core/client';
import { api } from '../../lib/api-client';

type LogLine = {
  id: string;
  text: string;
};

type UsersListResponse = {
  users: Array<{ id: string; name: string; email: string }>;
  total: number;
  limit: number;
  offset: number;
};

type KeyedResult<T> = {
  data: T | undefined;
  error: unknown;
  key: string;
};

const USERS_CACHE_KEY = 'demo:users:list';

const makeLogLine = (event: any) => {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const bg = event.isBackground ? ' (bg)' : '';
  return `${time} - ${event.method} - ${event.phase}${bg} - ${event.key}`;
};

async function getUsersWithKey(
  policy: 'cache-first' | 'stale-while-revalidate' | 'network-only',
  onStatus?: (event: any) => void,
) {
  return (await api.users.get(
    { query: { limit: '5' } },
    {
      key: USERS_CACHE_KEY,
      cache: {
        policy,
        staleTime: 5000,
        gcTime: 60000,
        dedupeMs: 200,
      },
      onStatus,
    } as any,
  )) as KeyedResult<UsersListResponse>;
}

export default function APIClientAdvancedDemo() {
  const [usersResponse, setUsersResponse] = useState<any>(null);
  const [usersKey, setUsersKey] = useState<string>(USERS_CACHE_KEY);
  const [statusLog, setStatusLog] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const addLog = (event: any) => {
    const line: LogLine = {
      id: `${event.timestamp}-${Math.random().toString(36).slice(2)}`,
      text: makeLogLine(event),
    };
    setStatusLog((prev) => [...prev.slice(-30), line]);
  };

  const users = useMemo(() => usersResponse?.users ?? [], [usersResponse]);

  const fetchUsers = async (policy: 'cache-first' | 'stale-while-revalidate') => {
    setLoading('users');
    setError(null);

    try {
      const result = await getUsersWithKey(policy, addLog);
      if (result.error) {
        setError(`Failed to fetch users: ${result.error}`);
      } else {
        setUsersResponse(result.data);
        setUsersKey(result.key);
        if (!selectedUserId && result.data?.users?.[0]?.id) {
          setSelectedUserId(result.data.users[0].id);
        }
      }
    } catch (err: any) {
      setError(`Failed to fetch users: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const createOptimisticUser = async () => {
    setError(null);

    if (!usersResponse) {
      await fetchUsers('cache-first');
    }

    setLoading('create');

    const name = `Optimistic ${Math.floor(Math.random() * 1000)}`;
    const email = `optimistic${Date.now()}@example.com`;
    const targetKey = usersKey || USERS_CACHE_KEY;
    const optimisticUpdater = (prev: any) => {
      const base = prev ?? { users: [], total: 0, limit: 5, offset: 0 };
      return {
        ...base,
        users: [{ id: `optimistic-${Date.now()}`, name, email }, ...base.users].slice(
          0,
          base.limit ?? 5,
        ),
        total: (base.total ?? base.users.length) + 1,
      };
    };
    const optimisticUpdate: [string, (prev: any) => any] = [targetKey, optimisticUpdater];
    const previousUsersResponse = usersResponse;

    try {
      setUsersResponse((prev: any) => optimisticUpdater(prev ?? previousUsersResponse));

      const {data , error} = await api.users.post(
        { body: { name, email } },
        {
          optimistic: {
            update: [optimisticUpdate],
            rollbackOnError: true,
          },
          invalidate: [targetKey],
          onRequest: () => {},
          onError: (err) => {},
          onSuccess: (data) => {},
          onStatus: addLog,
        }
      )
      if (error) {
        setError(`Create failed: ${error}`);
        setUsersResponse(previousUsersResponse);
      } else {
        setUsersKey(targetKey);
      }
      await fetchUsers('cache-first');
    } catch (err: any) {
      setError(`Create failed: ${err}`);
      setUsersResponse(previousUsersResponse);
    } finally {
      setLoading(null);
    }
  };

  const patchUser = async () => {
    if (!selectedUserId) return;
    setLoading('patch');
    setError(null);

    try {
      const result = await api.users.patch(
        { body: { id: selectedUserId, name: `Updated ${Date.now()}` } },
        {
          invalidate: [usersKey || USERS_CACHE_KEY],
          onStatus: addLog,
        },
      );

      if (result.error) {
        setError(`Update failed: ${result.error}`);
      } else {
        await fetchUsers('cache-first');
      }
    } catch (err: any) {
      setError(`Update failed: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const deleteUser = async () => {
    if (!selectedUserId) return;
    setLoading('delete');
    setError(null);

    try {
      const result = await api.users.delete(
        { body: { id: selectedUserId } },
        {
          invalidate: [usersKey || USERS_CACHE_KEY],
          onStatus: addLog,
        },
      );

      if (result.error) {
        setError(`Delete failed: ${result.error}`);
      } else {
        await fetchUsers('cache-first');
      }
    } catch (err: any) {
      setError(`Delete failed: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-black text-white p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">API Client</p>
          <h1 className="text-4xl md:text-5xl font-semibold text-white">
            Advanced Client Behaviors
          </h1>
          <p className="text-indigo-200 max-w-2xl">
            This page demonstrates cache policies, stale-while-revalidate, optimistic updates,
            invalidation, and status telemetry -- all from plain promise calls.
          </p>
        </header>

        {error && (
          <div className="bg-red-900/40 border border-red-500/60 rounded-lg p-4">
            {error}
          </div>
        )}

        <section className="grid lg:grid-cols-[2fr_1fr] gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white">1) Cached Query + Status</h2>
            <p className="text-sm text-indigo-200">
              Uses <code className="bg-black/40 px-1 rounded">cache-first</code> and{' '}
              <code className="bg-black/40 px-1 rounded">stale-while-revalidate</code> with
              status events.
            </p>
            <p className="text-xs text-indigo-300">
              Current cache key:{' '}
              <code className="bg-black/40 px-1 rounded">{usersKey}</code>
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => fetchUsers('cache-first')}
                disabled={loading === 'users'}
                className="px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500 disabled:opacity-50"
              >
                Fetch (cache-first)
              </button>
              <button
                onClick={() => fetchUsers('stale-while-revalidate')}
                disabled={loading === 'users'}
                className="px-4 py-2 bg-slate-700 rounded-lg hover:bg-slate-600 disabled:opacity-50"
              >
                Fetch (SWR)
              </button>
            </div>
            <div className="bg-black/40 rounded-lg p-4 text-xs font-mono text-emerald-200">
              {usersResponse ? JSON.stringify(usersResponse, null, 2) : 'No data yet'}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-white">Status Log</h2>
            <div className="space-y-2 text-xs font-mono text-indigo-100 max-h-72 overflow-auto">
              {statusLog.length === 0 ? (
                <p className="text-indigo-300">No status events yet.</p>
              ) : (
                statusLog.map((line) => (
                  <div key={line.id} className="border-b border-white/10 pb-2">
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white">2) Optimistic Create (POST)</h2>
            <p className="text-sm text-indigo-200">
              Adds a user to the cached list immediately, then invalidates the query after the
              mutation resolves.
            </p>
            <button
              onClick={createOptimisticUser}
              disabled={loading === 'create'}
              className="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50"
            >
              Create Optimistic User
            </button>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white">3) Update / Delete + Invalidate</h2>
            <p className="text-sm text-indigo-200">
              PATCH/DELETE mutations mark the cached query stale; the next fetch revalidates.
            </p>
            <div className="flex flex-col gap-3">
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-sm"
              >
                {users.length === 0 && (
                  <option value="">Fetch users first</option>
                )}
                {users.map((user: any) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.id})
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={patchUser}
                  disabled={loading === 'patch' || !selectedUserId}
                  className="px-4 py-2 bg-yellow-600 rounded-lg hover:bg-yellow-500 disabled:opacity-50"
                >
                  Patch Selected
                </button>
                <button
                  onClick={deleteUser}
                  disabled={loading === 'delete' || !selectedUserId}
                  className="px-4 py-2 bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-50"
                >
                  Delete Selected
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-semibold text-white">Usage Shape</h2>
          <pre className="bg-black/40 rounded-lg p-4 text-xs text-indigo-100 overflow-auto">
{`// Plain promise calls with client options
const users = await api.users.get(
  { query: { limit: '5' } },
  {
    key: 'demo:users:list',
    cache: { policy: 'stale-while-revalidate', staleTime: 5000 },
    onStatus: (e) => console.log(e.phase, e.key),
  }
)
console.log(users.data, users.error, users.key)

const created = await api.users.post(
  { body: { name: 'Ada', email: 'ada@example.com' } },
  {
    optimistic: {
      update: [[users.key, (prev) => prev]],
      rollbackOnError: true,
    },
    invalidate: [users.key],
  }
)
console.log(created.data, created.error)`}
          </pre>
        </section>

        <div className="flex justify-center">
          <Link
            href="/api-demo-client"
            className="inline-flex items-center px-5 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-colors"
          >
            Back to API Client Demo
          </Link>
        </div>
      </div>
    </div>
  );
}
