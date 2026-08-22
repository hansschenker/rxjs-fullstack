import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstValueFrom } from 'rxjs';

import { createMemoryTodoRepository } from '../src/database/memory-todos-repository';
import { createPgliteTodoRepository } from '../src/database/pglite-todos-repository';
import { createApp } from '../src/server/app';

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (
  actual: unknown,
  expected: unknown,
  message: string,
): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`,
    );
  }
};

const memoryRepository = createMemoryTodoRepository();
const pendingMemoryCreate$ = memoryRepository.create$({
  title: 'Cold repository operation',
});
const memoryBeforeSubscription = await firstValueFrom(memoryRepository.list$());
assert(
  !memoryBeforeSubscription.some((todo) => todo.title === 'Cold repository operation'),
  'M11: repository create effects must remain cold before subscription.',
);
await firstValueFrom(pendingMemoryCreate$);
const memoryAfterSubscription = await firstValueFrom(memoryRepository.list$());
assert(
  memoryAfterSubscription.some((todo) => todo.title === 'Cold repository operation'),
  'M11: subscribing should execute the repository create effect.',
);
await memoryRepository.close();

const tempRoot = await mkdtemp(join(tmpdir(), 'rxjs-fullstack-m11-'));
const dataDir = join(tempRoot, 'postgres');

try {
  const firstRepository = await createPgliteTodoRepository({ dataDir });
  const seededTodos = await firstValueFrom(firstRepository.list$());
  assertEqual(seededTodos.length, 2, 'M11: a fresh database should receive the two canonical seed Todos.');

  const pendingCreate$ = firstRepository.create$({
    title: 'Persist M11 database integration',
  });
  const beforeSubscription = await firstValueFrom(firstRepository.list$());
  assert(
    !beforeSubscription.some((todo) => todo.title === 'Persist M11 database integration'),
    'M11: PGlite inserts must not execute before the database Observable is subscribed.',
  );

  const created = await firstValueFrom(pendingCreate$);
  assert(created.id > 0, 'M11: database inserts should return the generated Todo id.');
  await firstRepository.close();

  const reopenedRepository = await createPgliteTodoRepository({ dataDir });
  const persistedTodos = await firstValueFrom(reopenedRepository.list$());
  assert(
    persistedTodos.some((todo) => todo.id === created.id && todo.title === created.title),
    'M11: a Todo must survive closing and reopening the filesystem-backed database.',
  );
  assertEqual(
    persistedTodos.filter((todo) => todo.title === 'Port TanStack Query to RxJS').length,
    1,
    'M11: migrations/seeding should be idempotent when the database is reopened.',
  );

  const databaseApp = createApp({ todosRepository: reopenedRepository });
  const todosResponse = await databaseApp.request('/api/todos');
  assertEqual(todosResponse.status, 200, 'M11: database-backed GET /api/todos should return HTTP 200.');
  const todosJson = (await todosResponse.json()) as ReadonlyArray<{
    readonly title: string;
  }>;
  assert(
    todosJson.some((todo) => todo.title === created.title),
    'M11: the HTTP read path should resolve from the injected database repository.',
  );

  const createResponse = await databaseApp.request('/api/actions/todos.create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Write through database-backed server action' }),
  });
  assertEqual(createResponse.status, 201, 'M11: server actions should write through the database repository.');

  const todosAfterActionResponse = await databaseApp.request('/api/todos');
  const todosAfterAction = (await todosAfterActionResponse.json()) as ReadonlyArray<{
    readonly title: string;
  }>;
  assert(
    todosAfterAction.some((todo) => todo.title === 'Write through database-backed server action'),
    'M11: database writes should become visible through the existing query API path.',
  );

  await reopenedRepository.close();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('M11 database integration verification passed.');
