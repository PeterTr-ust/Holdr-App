import { describe, expect, it } from "vitest";
import { formatDecimalInput, parseDecimal, todayIso } from "./input";

describe("parseDecimal", () => {
  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    [" 0,25 ", 0.25],
    [",5", 0.5],
    ["3.", 3],
  ])("parses %s", (input, expected) => {
    expect(parseDecimal(input)).toBeCloseTo(expected);
  });

  it.each(["", "abc", "1,2,3x", "--1"])("rejects %s", (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe("todayIso", () => {
  it("uses the local calendar date", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("formatDecimalInput", () => {
  it("uses the language's decimal separator", () => {
    expect(formatDecimalInput(104.62, "de")).toBe("104,62");
    expect(formatDecimalInput(104.62, "en")).toBe("104.62");
  });
});
