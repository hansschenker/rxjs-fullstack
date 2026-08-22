import type { ResolvedAuthSession } from '../auth/types';
import type { QueryClient } from '../query';
import type { QueryFetch } from '../queries/todos';

export interface ServerRouteContext {
  readonly queryClient: QueryClient;
  readonly fetch: QueryFetch;
  readonly auth: ResolvedAuthSession | null;
}
