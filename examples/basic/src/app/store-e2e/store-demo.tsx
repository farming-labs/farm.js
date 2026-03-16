"use client";

import { useEffect, useState } from "react";
import { createStore } from "@farmjs/core/client";

const demoStore = createStore(
  {
    theme: "light" as "light" | "dark",
    sidebar: false,
  },
  (store) => ({
    toggleSidebar() {
      store.sidebar.set((value) => !value);
    },
    toggleTheme() {
      store.theme.set((value) => (value === "light" ? "dark" : "light"));
    },
  }),
);

let wholeRenders = 0;
let themeRenders = 0;
let sidebarRenders = 0;
let pairRenders = 0;

export default function StoreDemo() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="space-y-6">
      <p data-testid="hydrated" className="text-sm text-slate-500">
        {hydrated ? "yes" : "no"}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="toggle-sidebar"
          className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          onClick={() => demoStore.toggleSidebar()}
        >
          Toggle sidebar
        </button>
        <button
          type="button"
          data-testid="toggle-theme"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
          onClick={() => demoStore.toggleTheme()}
        >
          Toggle theme
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <WholeStoreCard />
        <ThemeCard />
        <SidebarCard />
        <PairCard />
      </div>
    </div>
  );
}

function WholeStoreCard() {
  const state = demoStore.use();
  wholeRenders += 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Whole store</h2>
      <p data-testid="whole-state" className="mt-2 text-sm text-slate-700">
        {JSON.stringify(state)}
      </p>
      <p data-testid="whole-renders" className="mt-2 text-sm text-slate-500">
        renders:{wholeRenders}
      </p>
    </div>
  );
}

function ThemeCard() {
  const theme = demoStore.theme();

  themeRenders += 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Theme field</h2>
      <p data-testid="theme-value" className="mt-2 text-sm text-slate-700">
        {theme}
      </p>
      <p data-testid="theme-renders" className="mt-2 text-sm text-slate-500">
        renders:{themeRenders}
      </p>
    </div>
  );
}

function SidebarCard() {
  const sidebar = demoStore.sidebar();
  sidebarRenders += 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Sidebar field</h2>
      <p data-testid="sidebar-value" className="mt-2 text-sm text-slate-700">
        {String(sidebar)}
      </p>
      <p data-testid="sidebar-renders" className="mt-2 text-sm text-slate-500">
        renders:{sidebarRenders}
      </p>
    </div>
  );
}

function PairCard() {
  const pair = demoStore.use(["theme", "sidebar"]);
  pairRenders += 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Picked fields</h2>
      <p data-testid="pair-value" className="mt-2 text-sm text-slate-700">
        {JSON.stringify(pair)}
      </p>
      <p data-testid="pair-renders" className="mt-2 text-sm text-slate-500">
        renders:{pairRenders}
      </p>
    </div>
  );
}
