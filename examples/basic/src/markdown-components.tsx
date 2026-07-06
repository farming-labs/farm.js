import React from 'react';

export const components = {
  Callout(props: { children: React.ReactNode }) {
    return (
      <aside className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
        {props.children}
      </aside>
    );
  },
};
