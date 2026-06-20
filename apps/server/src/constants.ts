export const Env = ['development', 'test', 'production'] as const;
export type Env = (typeof Env)[number];
