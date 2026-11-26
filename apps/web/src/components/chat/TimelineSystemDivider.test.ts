import { describe, expect, it } from "vite-plus/test";
import { parseCompactTokenMetric, resolveCompactionRatio } from "./TimelineSystemDivider";

describe("context compaction token metrics", () => {
  it("parses formatted token strings with suffixes and decimals", () => {
    expect(parseCompactTokenMetric("128k")).toEqual({
      numericTotal: 128_000,
      displayValue: 128,
      suffix: "k",
      decimals: 0,
    });
    expect(parseCompactTokenMetric("1.4M")).toEqual({
      numericTotal: 1_400_000,
      displayValue: 1.4,
      suffix: "M",
      decimals: 1,
    });
    expect(parseCompactTokenMetric("850")).toEqual({
      numericTotal: 850,
      displayValue: 850,
      suffix: "",
      decimals: 0,
    });
    expect(parseCompactTokenMetric("unknown")).toBeNull();
  });

  it("computes clamped compaction squeeze ratios", () => {
    expect(resolveCompactionRatio("128k", "16k")).toBeCloseTo(0.125, 4);
    expect(resolveCompactionRatio("200k", "4k")).toBe(0.08);
    expect(resolveCompactionRatio("10k", "12k")).toBe(1);
    expect(resolveCompactionRatio("0", "0")).toBeNull();
  });
});
