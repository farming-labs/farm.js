// The loading state of every styled route. With `mobile.shells`, `farm build --mobile` also renders
// it inside the (styled) layout as each route's page shell: the app shows it before the document
// arrives and keeps it while offline. A shell has no scripts and no route data.
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <div className="skeleton-title" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </div>
  );
}
