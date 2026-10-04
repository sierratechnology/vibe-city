import { createTenantSkyscraperNavigationApiHandler } from './tenantSkyscraperNavigationApi.mjs';
import { createTenantSkyscraperNavigationHttpAdapter } from './tenantSkyscraperNavigationHttpAdapter.mjs';
import { createTenantSkyscraperNavigationTrustedSourceAdapter } from './tenantSkyscraperNavigationTrustedSourceAdapter.mjs';

const TypeErrorIntrinsic = TypeError;

export function createTenantSkyscraperNavigationComposition(source) {
  if (arguments.length !== 1) throw new TypeErrorIntrinsic('trusted navigation source is required');
  return createTenantSkyscraperNavigationHttpAdapter(
    createTenantSkyscraperNavigationApiHandler(
      createTenantSkyscraperNavigationTrustedSourceAdapter(source),
    ),
  );
}
