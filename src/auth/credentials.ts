import type { AuthCredentials } from './types';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_EMAIL_LENGTH = 254;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const parseAuthCredentials = (value: unknown): AuthCredentials | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const emailValue = Reflect.get(value, 'email');
  const passwordValue = Reflect.get(value, 'password');

  if (typeof emailValue !== 'string' || typeof passwordValue !== 'string') {
    return undefined;
  }

  const email = normalizeEmail(emailValue);
  const hasEmailShape =
    email.length > 3 &&
    email.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const hasPasswordLength =
    passwordValue.length >= MIN_PASSWORD_LENGTH && passwordValue.length <= MAX_PASSWORD_LENGTH;

  return hasEmailShape && hasPasswordLength ? { email, password: passwordValue } : undefined;
};
