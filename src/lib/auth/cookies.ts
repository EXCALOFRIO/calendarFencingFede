/** Only cookies this application owns. Never enumerate browser cookies. */
export const AUTH_COOKIES = [
  '__Secure-calendario-auth.session_token',
  'calendario-auth.session_token',
  '__Secure-calendario-auth.session_data',
  'calendario-auth.session_data',
  '__Secure-calendario-auth.dont_remember',
  'calendario-auth.dont_remember',
  // Exact managed-provider names, cleared at explicit logout only.
  '__Secure-neon-auth.session_token',
  '__Secure-neon-auth.local.session_data',
  'neon-auth.session_token',
  'neon-auth.local.session_data',
] as const;
