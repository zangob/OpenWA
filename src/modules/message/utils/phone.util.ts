// Shared phone-number normalization used by the campaign flow.
// Mirrors the validation rules in BulkUploadService so both the file-upload
// and JSON-recipient paths produce identical WhatsApp chat ids.

export interface NormalizedPhone {
  valid: boolean;
  chatId?: string;
  formatted?: string;
  error?: string;
}

/**
 * Clean, validate and format a raw phone number into a WhatsApp chat id
 * (`<digits>@c.us`). An optional default country code is prepended when the
 * number looks like a local number (<= 10 digits) and has no country code.
 */
export function normalizePhone(rawPhone: string, defaultCountryCode?: string): NormalizedPhone {
  if (rawPhone === null || rawPhone === undefined) {
    return { valid: false, error: 'Empty phone value' };
  }

  // Remove spaces, parentheses and dashes; keep a leading + for now.
  let cleaned = String(rawPhone).trim().replace(/\s/g, '').replace(/[()-]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // A leading zero on a long number is a trunk prefix; strip it.
  if (cleaned.length > 10 && cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: 'Contains non-numeric characters' };
  }

  // Prepend the default country code for local-looking numbers.
  if (defaultCountryCode && cleaned.length <= 10) {
    let code = defaultCountryCode.trim();
    if (code.startsWith('+')) code = code.substring(1);
    // Drop a single leading local zero before prepending the code.
    const local = cleaned.startsWith('0') ? cleaned.substring(1) : cleaned;
    if (/^\d+$/.test(code)) {
      cleaned = code + local;
    }
  }

  if (cleaned.length < 7) {
    return { valid: false, error: 'Too short (min 7 digits)' };
  }
  if (cleaned.length > 15) {
    return { valid: false, error: 'Too long (max 15 digits)' };
  }

  return { valid: true, formatted: cleaned, chatId: `${cleaned}@c.us` };
}

/**
 * Replace `{key}` placeholders in `text` with values from `vars`
 * (case-insensitive key match). Unknown placeholders are left untouched.
 */
export function applyTemplateVars(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  const lookup: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    lookup[k.toLowerCase()] = v;
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const val = lookup[key.toLowerCase()];
    return val !== undefined ? val : match;
  });
}
