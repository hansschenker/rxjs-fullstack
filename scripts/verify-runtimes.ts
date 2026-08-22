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
const nodeProcess = Bun.spawn(['node', 'dist/runtime/node.js'], {
  env: {
    ...Bun.env,
    PORT: String(nodePort),
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

const waitForNode = async (): Promise<Response> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${nodePort}/health`);
      if (response.ok) {
        return response;
      }
    } catch {
      // The Node process may still be binding the port.
    }

    await Bun.sleep(50);
  }

  throw new Error('M10: Node runtime did not become ready.');
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
  const nodeAbout = await fetch(`http://127.0.0.1:${nodePort}/about`);
  assertEqual(nodeAbout.status, 200, 'M10: actual Node.js runtime should serve SSR routes.');
  assertEqual(
    await nodeAbout.text(),
    await expectedAbout.text(),
    'M10: Node adapter must not change the route/data/SSR result.',
  );
} finally {
  nodeProcess.kill(15);
  await nodeProcess.exited;
}

console.log('M10 runtime adapter verification passed.');
