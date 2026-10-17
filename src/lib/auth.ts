/** The one shared password. The cookie holds a hash of it, never the password itself. */
export const AUTH_COOKIE = "lab_session";
/** "Logged in indefinitely": ten years. */
export const AUTH_MAX_AGE = 60 * 60 * 24 * 365 * 10;

/** From LAB_PASSWORD in .env.local. Never hardcoded: with it unset, nobody gets in. */
export function labPassword() {
  return process.env.LAB_PASSWORD || null;
}

/** Changing LAB_PASSWORD changes the token, which signs everyone out. */
export async function sessionToken() {
  const password = labPassword();
  if (!password) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`harmonia-ai-lab:${password}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
