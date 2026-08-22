import type { Observable } from 'rxjs';

import type { CreateTodoInput, Todo } from '../domain/todos';

export interface RepositoryOperationOptions {
  readonly signal?: AbortSignal;
}

export interface TodoRepository {
  list$(options?: RepositoryOperationOptions): Observable<readonly Todo[]>;
  create$(
    input: CreateTodoInput,
    options?: RepositoryOperationOptions,
  ): Observable<Todo>;
  close(): Promise<void>;
}

export const throwIfRepositoryOperationAborted = (
  signal: AbortSignal | undefined,
): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Database operation was aborted.');
  }
};
