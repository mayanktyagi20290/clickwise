// ──────────────────────────────────────────────────────────────
// Clickwise configuration — edit these before deploying.
// ──────────────────────────────────────────────────────────────
window.CW_CONFIG = {
  appName: 'Clickwise',

  // OAuth 2.0 Web client ID from Google Cloud Console
  // (APIs & Services › Credentials). Add your site's origin, e.g.
  // https://yourdomain.com, under "Authorized JavaScript origins".
  // Enable "Google Search Console API" in the same project.
  googleClientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  // Rows pulled per dimension through the API (GSC returns 25,000 per page).
  maxRows: 100000,

  // Rows pulled for the query × page report used by cannibalisation.
  maxQueryPageRows: 50000,

  // Default URL fragments treated as non-SEO pages (login, account, cart…).
  defaultExcludes: ['/login', '/signin', '/sign-in', '/signup', '/register', '/account', '/cart', '/checkout', '/auth/'],

  // URL words that suggest a dashboard, account or other utility page. Matching pages are
  // set aside from title-rewrite advice with the reason shown, and users can include them again.
  utilityHints: ['dashboard', 'admin', 'panel', 'account', 'accounts', 'my-account', 'profile', 'settings', 'login', 'logout', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'auth', 'cart', 'checkout', 'billing', 'inbox', 'notifications', 'wp-admin', 'preview']
};
