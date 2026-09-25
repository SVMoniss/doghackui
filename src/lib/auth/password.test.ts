import { describe, expect, it } from "vitest";

import { hashPassword, validateEmail, validatePassword, verifyPassword } from "./password";

describe("scrypt passwords", () => {
  it("hashes are salted and verify correctly", () => {
    const a = hashPassword("correct-horse-123");
    const b = hashPassword("correct-horse-123");
    expect(a).not.toBe(b);
    expect(verifyPassword("correct-horse-123", a)).toBe(true);
    expect(verifyPassword("correct-horse-123", b)).toBe(true);
    expect(verifyPassword("wrong-password", a)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("validates password and email rules", () => {
    expect(validatePassword("short")).toBeTruthy();
    expect(validatePassword("long-enough-password")).toBeNull();
    expect(validateEmail("not-an-email")).toBeTruthy();
    expect(validateEmail("judge@example.org")).toBeNull();
  });
});
