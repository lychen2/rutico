import { describe, expect, it } from "vite-plus/test";

import { getTableOverflowEdges } from "./table";

describe("getTableOverflowEdges", () => {
  it("reports no overflow edges when content fits or differs by at most 1px", () => {
    expect(getTableOverflowEdges({ scrollLeft: 0, scrollWidth: 320, clientWidth: 320 })).toEqual({
      start: false,
      end: false,
    });
    expect(getTableOverflowEdges({ scrollLeft: 0, scrollWidth: 321, clientWidth: 320 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("tracks start and end edges across scroll positions", () => {
    expect(getTableOverflowEdges({ scrollLeft: 0, scrollWidth: 480, clientWidth: 200 })).toEqual({
      start: false,
      end: true,
    });
    expect(getTableOverflowEdges({ scrollLeft: 120, scrollWidth: 480, clientWidth: 200 })).toEqual({
      start: true,
      end: true,
    });
    expect(getTableOverflowEdges({ scrollLeft: 280, scrollWidth: 480, clientWidth: 200 })).toEqual({
      start: true,
      end: false,
    });
  });

  it("handles negative RTL scrollLeft values symmetrically", () => {
    expect(getTableOverflowEdges({ scrollLeft: -120, scrollWidth: 480, clientWidth: 200 })).toEqual(
      {
        start: true,
        end: true,
      },
    );
    expect(getTableOverflowEdges({ scrollLeft: -280, scrollWidth: 480, clientWidth: 200 })).toEqual(
      {
        start: true,
        end: false,
      },
    );
  });
});
