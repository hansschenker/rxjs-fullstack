export const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;
const OPAQUE_TOKEN_BYTES = 32;
const textEncoder = new TextEncoder();

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export interface Pbkdf2PasswordHasherOptions {
  readonly iterations?: number;
}

const toBase64Url = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));

const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
};

const derivePassword = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

export const constantTimeEqualString = (
  left: string,
  right: string,
): boolean =>
  timingSafeEqual(textEncoder.encode(left), textEncoder.encode(right));

export const createPbkdf2PasswordHasher = ({
  iterations = PBKDF2_ITERATIONS,
}: Pbkdf2PasswordHasherOptions = {}): PasswordHasher => ({
  hash: async (password) => {
    const salt = randomBytes(PBKDF2_SALT_BYTES);
    const derived = await derivePassword(password, salt, iterations);
    return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
  },
  verify: async (password, encodedHash) => {
    const [algorithm, iterationText, saltText, hashText] = encodedHash.split('$');
    const parsedIterations = Number(iterationText);
    if (
      algorithm !== 'pbkdf2-sha256' ||
      !Number.isSafeInteger(parsedIterations) ||
      parsedIterations <= 0 ||
      !saltText ||
      !hashText
    ) {
      return false;
    }

    const expected = fromBase64Url(hashText);
    const actual = await derivePassword(
      password,
      fromBase64Url(saltText),
      parsedIterations,
    );
    return timingSafeEqual(actual, expected);
  },
});

export const createOpaqueToken = (): string =>
  toBase64Url(randomBytes(OPAQUE_TOKEN_BYTES));

export const hashOpaqueToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
  return toBase64Url(new Uint8Array(digest));
};
