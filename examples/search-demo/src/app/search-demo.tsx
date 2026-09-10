"use client";

import { createSearch, type SearchResult } from "@farm.js/search/client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

const siteSearch = createSearch();

type SearchState =
  | { status: "idle"; results: SearchResult[] }
  | { status: "loading"; results: SearchResult[] }
  | { status: "ready"; results: SearchResult[]; total: number }
  | { status: "error"; results: SearchResult[]; message: string };

export function SearchDemo() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle", results: [] });
  const request = useRef(0);

  useEffect(() => {
    const currentRequest = ++request.current;
    const term = query.trim();
    if (!term) {
      setState({ status: "idle", results: [] });
      return;
    }

    const timeout = window.setTimeout(() => {
      setState((current) => ({ status: "loading", results: current.results }));
      void siteSearch
        .search(term, { limit: 8 })
        .then((response) => {
          if (request.current !== currentRequest) return;
          setState({ status: "ready", results: response.results, total: response.total });
        })
        .catch((error: unknown) => {
          if (request.current !== currentRequest) return;
          setState({
            status: "error",
            results: [],
            message: error instanceof Error ? error.message : "Search could not load.",
          });
        });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [query]);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    setQuery(value);
    if (value.trim()) void siteSearch.preload(value).catch(() => undefined);
  }

  const status =
    state.status === "loading"
      ? "Searching indexed pages"
      : state.status === "ready"
        ? `${state.total} result${state.total === 1 ? "" : "s"}`
        : state.status === "error"
          ? "Search unavailable"
          : "Ready for a query";

  return (
    <section className="search-panel" aria-labelledby="search-title">
      <div className="search-heading">
        <div>
          <p className="eyebrow">Production index</p>
          <h2 id="search-title">Find a guide</h2>
        </div>
        <span className="search-status" data-status={state.status} aria-live="polite">
          {status}
        </span>
      </div>

      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="site-search">Search the static pages</label>
        <div className="search-control">
          <span aria-hidden="true">⌕</span>
          <input
            id="site-search"
            type="search"
            value={query}
            onChange={onChange}
            placeholder="Try “authorization”"
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                request.current++;
                setState({ status: "idle", results: [] });
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </form>

      <div className="results" aria-busy={state.status === "loading"}>
        {state.status === "idle" ? (
          <p className="empty-state">The index stays unloaded until you start typing.</p>
        ) : null}

        {state.status === "error" ? (
          <div className="error-state" role="alert">
            <strong>Search could not start</strong>
            <p>{state.message}</p>
          </div>
        ) : null}

        {state.status === "ready" && state.results.length === 0 ? (
          <p className="empty-state">No indexed page matches “{query}”. Try a broader term.</p>
        ) : null}

        {state.results.length ? (
          <ol>
            {state.results.map((result) => (
              <li key={result.id}>
                <a href={result.url}>
                  <span className="result-path">{result.url}</span>
                  <strong>{result.title}</strong>
                  <span>{result.plainExcerpt}</span>
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
