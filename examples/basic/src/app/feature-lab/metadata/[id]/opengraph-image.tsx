import type { PageProps } from '@farm.js/core';

export const size = { width: 1200, height: 630 };
export const alt = 'Feature metadata preview';
export const revalidate = 300;

function ProductCard({ id }: { id: string }) {
  return (
    <div className="flex h-full w-full flex-col justify-between bg-[#09090b] p-20 text-white">
      <span className="text-3xl font-medium text-emerald-400">Farm.js</span>
      <div className="flex flex-col">
        <span className="text-2xl text-zinc-400">Product</span>
        <span className="mt-3 text-8xl font-bold tracking-tight">{id}</span>
      </div>
    </div>
  );
}

export default function FeatureOpenGraphImage({ params }: PageProps) {
  return <ProductCard id={params.id} />;
}
