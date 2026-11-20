import { tt, type MessageKey } from "../i18n/core";

/** Firebase Auth error codes → message keys (text a listener can act on, in their language). */
const MESSAGES: Record<string, MessageKey> = {
  "auth/invalid-credential": "authErr.invalidCredential",
  "auth/invalid-login-credentials": "authErr.invalidCredential",
  "auth/wrong-password": "authErr.wrongPassword",
  "auth/user-not-found": "authErr.userNotFound",
  "auth/invalid-email": "authErr.invalidEmail",
  "auth/missing-email": "authErr.missingEmail",
  "auth/missing-password": "authErr.missingPassword",
  "auth/email-already-in-use": "authErr.emailInUse",
  "auth/weak-password": "authErr.weakPassword",
  "auth/password-does-not-meet-requirements": "authErr.passwordRequirements",
  "auth/too-many-requests": "authErr.tooManyRequests",
  "auth/network-request-failed": "authErr.network",
  "auth/user-disabled": "authErr.userDisabled",
  "auth/operation-not-allowed": "authErr.operationNotAllowed",
  "auth/unauthorized-domain": "authErr.unauthorizedDomain",
  "auth/popup-blocked": "authErr.popupBlocked",
  "auth/popup-closed-by-user": "authErr.popupClosed",
  "auth/cancelled-popup-request": "authErr.popupClosed",
  "auth/account-exists-with-different-credential": "authErr.accountExists",
  "auth/credential-already-in-use": "authErr.credentialInUse",
  "auth/provider-already-linked": "authErr.providerLinked",
  "auth/no-such-provider": "authErr.noSuchProvider",
  "auth/requires-recent-login": "authErr.recentLogin",
  "auth/user-mismatch": "authErr.userMismatch",
  "auth/user-token-expired": "authErr.tokenExpired",
  "auth/invalid-action-code": "authErr.invalidActionCode",
  "auth/expired-action-code": "authErr.expiredActionCode",
  "auth/invalid-api-key": "authErr.invalidApiKey",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "authErr.invalidApiKey",
  "auth/configuration-not-found": "authErr.configNotFound",
  "auth/internal-error": "authErr.internal",
};

export function authErrorCode(e: unknown): string {
  return typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
}

export function authErrorMessage(e: unknown): string {
  const code = authErrorCode(e);
  if (MESSAGES[code]) return tt(MESSAGES[code]);
  if (e instanceof Error && e.message && !code) return e.message;
  return tt("authErr.internal");
}

/** The listener closed the popup themselves: not worth an error message. */
export const isPopupDismissal = (e: unknown) =>
  ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(authErrorCode(e));

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

const LABELS: MessageKey[] = ["pw.tooShort", "pw.weak", "pw.fair", "pw.good", "pw.strong"];

/** Simple strength hint (Firebase itself enforces min 6 chars, or the project's password policy). */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: "", hint: tt("pw.hintLength") };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1);
  const s = Math.min(4, score) as PasswordStrength["score"];
  const hint = pw.length < 8 ? tt("pw.hintLength") : s < 3 ? tt("pw.hintStronger") : tt("pw.hintGood");
  return { score: s, label: tt(LABELS[s]), hint };
}
