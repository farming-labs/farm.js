import { getEnv, getPublicEnv } from '@farmjs/core/env';
import type { LinkProps, ResolvedRouteHref } from '@farmjs/core/client';

const serverUrl: string = getEnv('FARM_API_URL');
const publicName: string = getPublicEnv('PUBLIC_APP_NAME');
const resolvedProduct: ResolvedRouteHref = '/feature-lab/products/42';

const typedProductLink: LinkProps<'/feature-lab/products/[id]'> = {
  href: '/feature-lab/products/[id]',
  params: { id: '42' },
};

// @ts-expect-error Public keys must not be accepted by the server env helper.
getEnv('PUBLIC_APP_NAME');
// @ts-expect-error Server keys must not be accepted by the public env helper.
getPublicEnv('FARM_API_URL');
// @ts-expect-error Dynamic route patterns require their declared params.
const missingProductParams: LinkProps<'/feature-lab/products/[id]'> = {
  href: '/feature-lab/products/[id]',
};

void serverUrl;
void publicName;
void resolvedProduct;
void typedProductLink;
void missingProductParams;
