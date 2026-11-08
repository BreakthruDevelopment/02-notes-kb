import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type UsageKind = "embed" | "ask";

const today = sql`(now() at time zone 'utc')::date`;

/**
 * Atomically add `n` to today's (UTC) counter, only if the total stays within `cap`.
 * Returns false, changing nothing, when it wouldn't fit.
 */
export async function reserveUsage(kind: UsageKind, n: number, cap: number): Promise<boolean> {
  if (n <= 0) return true;
  if (n > cap) return false;
  const rows = await db().execute<{ count: number }>(sql`
    insert into ai_usage (day, kind, count) values (${today}, ${kind}, ${n}::int)
    on conflict (day, kind) do update set count = ai_usage.count + ${n}::int
      where ai_usage.count + ${n}::int <= ${cap}::int
    returning count
  `);
  return rows.length > 0;
}

/** Give back a reservation that wasn't used (the call failed, or was answered by the free demo provider). */
export async function refundUsage(kind: UsageKind, n: number): Promise<void> {
  if (n <= 0) return;
  await db().execute(sql`
    update ai_usage set count = greatest(count - ${n}::int, 0) where day = ${today} and kind = ${kind}
  `);
}

export async function usageToday(): Promise<Record<UsageKind, number>> {
  const rows = await db().execute<{ kind: UsageKind; count: number }>(
    sql`select kind, count from ai_usage where day = ${today}`,
  );
  const out: Record<UsageKind, number> = { embed: 0, ask: 0 };
  for (const r of rows) out[r.kind] = Number(r.count);
  return out;
}
