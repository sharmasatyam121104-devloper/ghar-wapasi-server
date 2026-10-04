const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AADHAAR_PATTERN = /^\d{12}$/;
const MOBILE_PATTERN = /^\d{10}$/;
const PASSWORD_MIN_LENGTH = 6;

/**
 * Tolerates a missing value: a public account registers without an email, and
 * signing its tokens used to crash on `undefined.trim()`.
 */
export const normalizeEmail = (value: string | undefined | null): string =>
    (value ?? "").trim().toLowerCase();

export const stripNonDigits = (value: string): string => value.replace(/\D/g, "");

export const isEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const isAadhaar = (value: string): boolean => AADHAAR_PATTERN.test(stripNonDigits(value));

export const isMobile = (value: string): boolean => MOBILE_PATTERN.test(stripNonDigits(value));

export const isStrongEnough = (value: string): boolean => value.length >= PASSWORD_MIN_LENGTH;

/** Frontend shows aadhaar as `XXXX XXXX 1234`; never ship the full value back. */
export const maskAadhaar = (value: string): string => {
    const digits = stripNonDigits(value);
    if (digits.length !== 12) return value;
    return `XXXX XXXX ${digits.slice(-4)}`;
};

/** Frontend accepts a meeting link that starts with http:// or https://. */
export const isHttpUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim());

export { PASSWORD_MIN_LENGTH };
