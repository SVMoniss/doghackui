/**
 * Password hashing with scrypt (node:crypto, no dependencies).
 * Stored format: scrypt$N$r$p$saltHex$hashHex
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P }).toString("hex");
  return `scrypt$${N}$${R}$${P}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, n, r, p, salt, expected] = stored.split("$");
    if (algo !== "scrypt" || !salt || !expected) return false;
    const hash = scryptSync(password, salt, KEYLEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    }).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Use at most 72 characters.";
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 255) {
    return "Enter a valid email address.";
  }
  return null;
}
