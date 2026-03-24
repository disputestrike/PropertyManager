export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** True when Manus (or other) OAuth portal env is set. */
export const isOAuthConfigured = () => {
  const portal = import.meta.env.VITE_OAUTH_PORTAL_URL?.trim();
  const appId = import.meta.env.VITE_APP_ID?.trim();
  return Boolean(portal && appId);
};

/**
 * OAuth sign-in URL, or app home when OAuth env vars are missing (open / local mode).
 */
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL?.trim();
  const appId = import.meta.env.VITE_APP_ID?.trim();
  if (!oauthPortalUrl || !appId) {
    return `${window.location.origin}/`;
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);
  let url: URL;
  try {
    const portal = new URL(oauthPortalUrl, window.location.origin);
    portal.pathname = `${portal.pathname.replace(/\/$/, "")}/app-auth`;
    url = portal;
  } catch {
    // Avoid crashing the app on malformed deployment env vars.
    return `${window.location.origin}/`;
  }
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
