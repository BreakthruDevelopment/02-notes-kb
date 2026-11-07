import type { z } from "zod";

export type GenerateRequest<T> = {
  /** Stable name for this AI feature, e.g. "summarize-items". Used for demo fixtures and logs. */
  task: string;
  system: string;
  prompt: string;
  /** Output is parsed as JSON and validated; invalid output is an error, never shown raw. */
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
};

export type GenerateResult<T> = {
  data: T;
  provider: string;
  model: string;
  /** True when the answer came from recorded demo data instead of a live model. */
  demo: boolean;
  latencyMs: number;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Returns raw model text, expected to be JSON. */
  complete(req: { system: string; prompt: string; maxOutputTokens: number }): Promise<string>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "quota" | "provider" | "invalid_output" | "input_rejected",
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type EmbedRequest = {
  /** Stable name for the caller, e.g. "embed-note". Used in logs. */
  task: string;
  texts: string[];
  /** "document" for content being indexed, "query" for a search question. */
  kind: "document" | "query";
};

export type EmbedResult = {
  /** One L2-normalized vector per input text, in order. */
  vectors: number[][];
  provider: string;
  /** Callers must store this with the vector and only compare vectors with the same model. */
  model: string;
  dims: number;
  demo: boolean;
  latencyMs: number;
};
