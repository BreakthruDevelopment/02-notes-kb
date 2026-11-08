export type ReindexState = {
  error: string | null;
  processed: number | null;
  remaining: number | null;
};

export const emptyReindexState: ReindexState = { error: null, processed: null, remaining: null };

export type DemoState = { error: string | null; message: string | null };

export const emptyDemoState: DemoState = { error: null, message: null };
