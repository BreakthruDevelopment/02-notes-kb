import { z } from "zod";

/** Checked before importing the database/auth loader, including for CLI refusals. */
export function demoSeedConfig(values: Record<string, string | undefined> = process.env) {
  if (values.DEMO_SEED !== "yes") throw new Error("Demo seed refused: set DEMO_SEED=yes.");
  const appUrl = z.string().url().parse(values.APP_URL);
  const hostname = new URL(appUrl).hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "app2.breakthruventures.ai" || hostname === "azurecontainerapps.io" || hostname.endsWith(".azurecontainerapps.io")) {
    throw new Error("Demo seed refused: APP_URL is a production host.");
  }
  const password = z.string().min(10).max(128).parse(values.DEMO_PASSWORD);
  return { appUrl, password };
}
