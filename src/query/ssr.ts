import { hydrate } from './hydration';
import type { QueryClient } from './queryClient';

export const QUERY_STATE_SCRIPT_ID = 'rxjs-query-state';

export interface QueryStateDocument {
  getElementById(id: string): { readonly textContent: string | null } | null;
}

export const hydrateQueryClientFromDocument = (
  client: QueryClient,
  documentLike: QueryStateDocument,
): boolean => {
  const element = documentLike.getElementById(QUERY_STATE_SCRIPT_ID);
  const serializedState = element?.textContent;

  if (!serializedState) {
    return false;
  }

  hydrate(client, JSON.parse(serializedState) as unknown);
  return true;
};
