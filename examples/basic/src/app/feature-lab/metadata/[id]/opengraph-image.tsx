import type { PageProps } from '@farm.js/core';

export const size = { width: 1200, height: 630 };
export const alt = 'Feature metadata preview';
export const contentType = 'image/svg+xml';

export default function FeatureOpenGraphImage({ params }: PageProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#0f172a" />
      <text x="80" y="340" fill="white" fontSize="72">
        Feature product {params.id}
      </text>
    </svg>
  );
}
