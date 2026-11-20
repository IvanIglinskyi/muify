/** Firebase Auth error codes → text a listener can act on. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "The email or password is incorrect.",
  "auth/invalid-login-credentials": "The email or password is incorrect.",
  "auth/wrong-password": "The password is incorrect.",
  "auth/user-not-found": "There is no account with this email.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-email": "Please enter your email address.",
  "auth/missing-password": "Please enter your password.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "This password is too weak. Use at least 8 characters with letters and numbers.",
  "auth/password-does-not-meet-requirements": "This password doesn't meet the password requirements.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/operation-not-allowed": "This sign-in method is not enabled for MuiFy.",
  "auth/unauthorized-domain": "Sign-in is not allowed from this address (add the domain to Firebase authorized domains).",
  "auth/popup-blocked": "The sign-in popup was blocked by the browser.",
  "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
  "auth/cancelled-popup-request": "The sign-in window was closed before finishing.",
  "auth/account-exists-with-different-credential":
    "An account with this email already exists. Sign in with your password, then link Google in Account settings.",
  "auth/credential-already-in-use": "This Google account is already linked to another MuiFy account.",
  "auth/provider-already-linked": "This sign-in method is already linked to your account.",
  "auth/no-such-provider": "This sign-in method is not linked to your account.",
  "auth/requires-recent-login": "For your security, please confirm your identity and try again.",
  "auth/user-mismatch": "Please confirm with the same account you are signed in with.",
  "auth/user-token-expired": "Your session has expired. Please sign in again.",
  "auth/invalid-action-code": "This link is invalid or has already been used.",
  "auth/expired-action-code": "This link has expired. Please request a new one.",
  "auth/invalid-api-key": "Sign-in is misconfigured (invalid API key).",
  "auth/configuration-not-found": "Sign-in is not configured for this Firebase project.",
  "auth/internal-error": "Something went wrong. Please try again.",
};

export function authErrorCode(e: unknown): string {
  return typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
}

export function authErrorMessage(e: unknown): string {
  const code = authErrorCode(e);
  if (MESSAGES[code]) return MESSAGES[code];
  if (e instanceof Error && e.message && !code) return e.message;
  return "Something went wrong. Please try again.";
}

/** The listener closed the popup themselves: not worth an error message. */
export const isPopupDismissal = (e: unknown) =>
  ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(authErrorCode(e));

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

/** Simple strength hint (Firebase itself enforces min 6 chars, or the project's password policy). */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: "", hint: "Use at least 8 characters." };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1);
  const s = Math.min(4, score) as PasswordStrength["score"];
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const hint =
    pw.length < 8
      ? "Use at least 8 characters."
      : s < 3
        ? "Add upper-case letters, numbers or symbols to make it stronger."
        : "Nice — that's a solid password.";
  return { score: s, label: labels[s], hint };
}
