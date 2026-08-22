export interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

export interface CreateTodoInput {
  readonly title: string;
}

export const createTodoInput = (title: string): CreateTodoInput | undefined => {
  const normalizedTitle = title.trim();
  return normalizedTitle.length > 0 ? { title: normalizedTitle } : undefined;
};

export const parseCreateTodoInput = (value: unknown): CreateTodoInput | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const title = Reflect.get(value, 'title');
  return typeof title === 'string' ? createTodoInput(title) : undefined;
};
