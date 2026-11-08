/** Stable UTC timestamp for server-rendered pages. */
export function formatWhen(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
