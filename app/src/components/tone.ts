/** CSS class for coloring a result: green for gains, red for losses. */
export function tone(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || Math.abs(value) < 0.005) return undefined;
  return value > 0 ? "pos" : "neg";
}
