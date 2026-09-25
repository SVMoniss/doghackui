import { describe, expect, it } from "vitest";

import { toCsvRows } from "./export-csv";

describe("toCsvRows", () => {
  it("quotes every cell and doubles embedded quotes", () => {
    const csv = toCsvRows(["name", "note"], [["Ada", 'says "hi", twice']]);
    expect(csv).toBe('"name","note"\n"Ada","says ""hi"", twice"');
  });

  it("renders null/undefined as empty quoted cells", () => {
    expect(toCsvRows(["a", "b"], [[null, undefined]])).toBe('"a","b"\n"",\"\"');
  });

  it("handles header-only exports", () => {
    expect(toCsvRows(["a"], [])).toBe('"a"');
  });

  it("joins multiple rows with newlines", () => {
    expect(toCsvRows(["n"], [["1"], ["2"]])).toBe('"n"\n"1"\n"2"');
  });
});
