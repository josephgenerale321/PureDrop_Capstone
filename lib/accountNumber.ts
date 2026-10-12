/**
 * Account number helpers for PureDrop.
 *
 * The account-level "Account number" (e.g. 032-012-361) replaces the old
 * numeric "Water meter" field on the register / profile / admin user flows.
 * It is ALWAYS stored as a string so the leading zero survives (a number
 * type would turn "032-012-361" into 32).
 *
 * Canonical shape: 3 digits - 3 digits - 3 digits (11 chars with dashes).
 */

export const ACCOUNT_NUMBER_PATTERN = /^\d{3}-\d{3}-\d{3}$/;
export const ACCOUNT_NUMBER_PLACEHOLDER = "032-012-361";
export const ACCOUNT_NUMBER_MAX_LENGTH = 11;

/** Strip everything but digits, capped at 9 (the 3-3-3 payload). */
export function accountNumberDigits(value: unknown): string {
  return String(value ?? "").replace(/[^\d]/g, "").slice(0, 9);
}

/**
 * Format-as-you-type: "032012361" -> "032-012-361".
 * Partial input is dashed progressively ("03201" -> "032-01").
 */
export function formatAccountNumber(value: unknown): string {
  const digits = accountNumberDigits(value);
  const parts: string[] = [];
  if (digits.length > 0) parts.push(digits.slice(0, 3));
  if (digits.length > 3) parts.push(digits.slice(3, 6));
  if (digits.length > 6) parts.push(digits.slice(6, 9));
  return parts.join("-");
}

/** Strict check for the complete "XXX-XXX-XXX" shape. */
export function isValidAccountNumber(value: unknown): boolean {
  return ACCOUNT_NUMBER_PATTERN.test(String(value ?? "").trim());
}

/**
 * Legacy fallback: old `regular_user` docs carry a numeric `waterMeter`.
 * Prefer the new `accountNumber` string, otherwise stringify the legacy
 * value so existing accounts keep displaying instead of going blank.
 */
export function resolveAccountNumber(
  data?: { accountNumber?: unknown; waterMeter?: unknown } | null,
): string | null {
  const current = data?.accountNumber;
  if (typeof current === "string" && current.trim().length > 0) {
    return current.trim();
  }
  const legacy = data?.waterMeter;
  if (typeof legacy === "string" && legacy.trim().length > 0) {
    return legacy.trim();
  }
  if (typeof legacy === "number" && Number.isFinite(legacy)) {
    return String(legacy);
  }
  return null;
}
