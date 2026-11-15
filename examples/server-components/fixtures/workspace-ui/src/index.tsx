import { WidgetCounter } from "@farm-fixtures/widget-kit";

// A server component: the app renders it, and it renders the client component of a package
// only this workspace package depends on.
export function WidgetPanel({ title }: { title: string }) {
  return (
    <article>
      <h2 data-testid="widget-title">{title}</h2>
      <WidgetCounter label="widget clicks" />
    </article>
  );
}
