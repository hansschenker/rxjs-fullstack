import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import bunRuntime from '../src/runtime/bun';
import cloudflareRuntime from '../src/runtime/cloudflare';
import { fetchHandler } from '../src/runtime/fetch';

declare const Bun: {
  readonly env: Record<string, string | undefined>;
  spawn(
    command: readonly string[],
    options?: {
      readonly env?: Record<string, string | undefined>;
      readonly stdout?: 'inherit' | 'ignore';
      readonly stderr?: 'inherit' | 'ignore';
    },
  ): {
    readonly exited: Promise<number>;
    kill(signal?: number): void;
  };
  sleep(milliseconds: number): Promise<void>;
};

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

const requestRuntime = async (
  handler: typeof fetchHandler,
  pathname: string,
): Promise<Response> =>
  handler(new Request(`http://rxjs-fullstack.runtime${pathname}`));

const getSetCookie = (headers: Headers): readonly string[] => {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (extended.getSetCookie) {
    return extended.getSetCookie();
  }
  const combined = headers.get('set-cookie');
  return combined ? combined.split(/,(?=[^;,]+=)/u) : [];
};

const cookiePair = (cookie: string): string => cookie.split(';', 1)[0] ?? '';

assertEqual(
  bunRuntime.port,
  3000,
  'M10: Bun adapter should retain port 3000 as the default runtime boundary.',
);

const directHealth = await requestRuntime(fetchHandler, '/health');
const bunHealth = await requestRuntime(bunRuntime.fetch, '/health');
const workerHealth = await requestRuntime(cloudflareRuntime.fetch, '/health');

assertEqual(directHealth.status, 200, 'M10: shared fetch handler should serve /health.');
assertEqual(bunHealth.status, 200, 'M10: Bun adapter should expose the shared fetch handler.');
assertEqual(workerHealth.status, 200, 'M10: Cloudflare adapter should expose the shared fetch handler.');
assertEqual(
  await bunHealth.text(),
  await workerHealth.text(),
  'M10: fetch-native runtime adapters should observe the same application response.',
);

const directAbout = await requestRuntime(fetchHandler, '/about');
const workerAbout = await requestRuntime(cloudflareRuntime.fetch, '/about');
assertEqual(
  await workerAbout.text(),
  await directAbout.text(),
  'M10: Cloudflare-style execution should preserve SSR output exactly.',
);

const nodePort = 31_027;
const nodeOrigin = `http://127.0.0.1:${nodePort}`;
const nodeDatabaseRoot = await mkdtemp(join(tmpdir(), 'rxjs-fullstack-node-m12-'));
const nodeProcess = Bun.spawn(['node', 'dist/runtime/node.js'], {
  env: {
    ...Bun.env,
    PORT: String(nodePort),
    DATABASE_PATH: join(nodeDatabaseRoot, 'postgres'),
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

const waitForNode = async (): Promise<Response> => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${nodeOrigin}/health`);
      if (response.ok) {
        return response;
      }
    } catch {
      // PGlite initialization and Node port binding may still be in progress.
    }

    await Bun.sleep(50);
  }

  throw new Error('M10-M12: Node runtime did not become ready.');
};

try {
  const nodeHealth = await waitForNode();
  assertEqual(nodeHealth.status, 200, 'M10: actual Node.js runtime should serve /health.');
  assertEqual(
    await nodeHealth.text(),
    '{"ok":true}',
    'M10: Node.js runtime should preserve the Hono application response.',
  );

  const expectedAbout = await requestRuntime(fetchHandler, '/about');
  const nodeAbout = await fetch(`${nodeOrigin}/about`);
  assertEqual(nodeAbout.status, 200, 'M10: actual Node.js runtime should serve SSR routes.');
  assertEqual(
    await nodeAbout.text(),
    await expectedAbout.text(),
    'M10: Node adapter must not change the route/data/SSR result.',
  );

  const nodeTodos = await fetch(`${nodeOrigin}/api/todos`);
  const nodeTodosJson = (await nodeTodos.json()) as ReadonlyArray<{
    readonly title: string;
  }>;
  assert(
    nodeTodosJson.some((todo) => todo.title === 'Port TanStack Query to RxJS'),
    'M11: actual Node runtime should expose the seeded database-backed Todo repository.',
  );

  const nodeCredentials = new URLSearchParams({
    email: 'node-runtime@rxjs-fullstack.test',
    password: 'node-runtime-password',
  });
  const nodeRegister = await fetch(`${nodeOrigin}/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: nodeOrigin,
    },
    body: nodeCredentials,
    redirect: 'manual',
  });
  assertEqual(nodeRegister.status, 303, 'M12: real Node runtime should register an auth user.');

  const nodeLogin = await fetch(`${nodeOrigin}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: nodeOrigin,
    },
    body: nodeCredentials,
    redirect: 'manual',
  });
  assertEqual(nodeLogin.status, 303, 'M12: real Node runtime should authenticate the persisted user.');
  assertEqual(
    nodeLogin.headers.get('location'),
    '/account/profile',
    'M12: real Node login should redirect to the protected account route.',
  );

  const authCookies = getSetCookie(nodeLogin.headers);
  const sessionCookie = authCookies.find((cookie) => cookie.startsWith('id='));
  const csrfCookie = authCookies.find((cookie) => cookie.startsWith('csrf='));
  assert(sessionCookie && csrfCookie, 'M12: real Node login should issue both authentication cookies.');
  const authCookieHeader = `${cookiePair(sessionCookie)}; ${cookiePair(csrfCookie)}`;

  const nodeAccount = await fetch(`${nodeOrigin}/account/profile`, {
    headers: { cookie: authCookieHeader },
    redirect: 'manual',
  });
  assertEqual(nodeAccount.status, 200, 'M12: real Node session should authorize protected SSR.');
  assert(
    (await nodeAccount.text()).includes('node-runtime@rxjs-fullstack.test'),
    'M12: real Node protected SSR should receive the persisted authenticated user.',
  );
} finally {
  nodeProcess.kill(15);
  await nodeProcess.exited;
  await rm(nodeDatabaseRoot, { recursive: true, force: true });
}

console.log('M10-M12 runtime adapter verification passed.');
