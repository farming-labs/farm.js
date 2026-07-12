import type { PageProps } from '@farmjs/core';

export async function generateMetadata({ params }: PageProps) {
  return {
    title: `Metadata product ${params.id}`,
    description: `Metadata route for product ${params.id}`,
  };
}

export default function MetadataProductPage({ params }: PageProps) {
  return <h1 data-testid="metadata-product">Metadata product {params.id}</h1>;
}
