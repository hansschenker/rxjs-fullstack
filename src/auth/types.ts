export interface AuthUser {
  readonly id: number;
  readonly email: string;
}

export interface AuthCredentials {
  readonly email: string;
  readonly password: string;
}

export interface CreatedAuthSession {
  readonly user: AuthUser;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

export interface ResolvedAuthSession {
  readonly user: AuthUser;
  readonly sessionTokenHash: string;
  readonly csrfValid: boolean;
  readonly csrfToken?: string;
}
