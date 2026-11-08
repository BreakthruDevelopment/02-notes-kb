import { errorInfo } from "@/lib/http";

/** First field error, then the client-safe message. Never a stack trace. */
export function formError(err: unknown): string {
  const { body } = errorInfo(err);
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues) {
      if (issue && typeof issue === "object" && "message" in issue && typeof issue.message === "string" && issue.message) {
        return issue.message;
      }
    }
  }
  return body.error;
}
