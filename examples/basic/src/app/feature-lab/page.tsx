import FeatureLabClient from './feature-lab-client';

export const metadata = {
  title: 'Recent features lab | Farm.js',
  description: 'A compact integration surface for recently merged Farm features.',
};

export default function FeatureLabPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase text-blue-700">Regression application</p>
        <h1 className="text-4xl font-bold text-slate-950">Recent features lab</h1>
        <p className="text-slate-700">
          This page exercises navigation, typed routes, environment boundaries, layers, and
          request-driven route data together.
        </p>
      </header>
      <FeatureLabClient />
    </main>
  );
}
