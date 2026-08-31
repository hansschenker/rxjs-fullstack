export interface DatabaseMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const databaseMigrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'create_todos',
    sql: `
      CREATE TABLE todos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE
      );
    `,
  },
  {
    version: 2,
    name: 'create_authentication',
    sql: `
      CREATE TABLE auth_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        csrf_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX auth_sessions_expires_at_idx
        ON auth_sessions (expires_at);
    `,
  },
];
