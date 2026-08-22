export interface RepositoryOperationOptions {
  readonly signal?: AbortSignal;
}

export const throwIfRepositoryOperationAborted = (
  signal: AbortSignal | undefined,
): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Repository operation was aborted.');
  }
};
