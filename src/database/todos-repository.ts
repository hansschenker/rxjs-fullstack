import type { Observable } from 'rxjs';

import type { CreateTodoInput, Todo } from '../domain/todos';
import type { RepositoryOperationOptions } from './repository';

export type { RepositoryOperationOptions } from './repository';
export { throwIfRepositoryOperationAborted } from './repository';

export interface TodoRepository {
  list$(options?: RepositoryOperationOptions): Observable<readonly Todo[]>;
  create$(input: CreateTodoInput, options?: RepositoryOperationOptions): Observable<Todo>;
  close(): Promise<void>;
}
