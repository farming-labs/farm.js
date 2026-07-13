import IntegrationLabClient from './integration-lab-client';

export const metadata = {
  title: 'Integration runtime lab | Farm.js',
};

export default function IntegrationLabPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase text-blue-700">Regression application</p>
        <h1 className="text-3xl font-bold text-slate-950">Integration runtime lab</h1>
      </header>

      <IntegrationLabClient />
    </main>
  );
}
