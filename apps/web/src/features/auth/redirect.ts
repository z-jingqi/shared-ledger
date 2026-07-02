const authPaths = new Set(["/login", "/register"]);

export function authRedirectTarget(search: string, fallback = "/") {
  const redirect = new URLSearchParams(search).get("redirect");
  if (!redirect) return fallback;

  try {
    const target = new URL(redirect, window.location.origin);
    if (target.origin !== window.location.origin) return fallback;
    if (authPaths.has(target.pathname)) return fallback;
    return `${target.pathname}${target.search}${target.hash}` || fallback;
  } catch {
    return fallback;
  }
}
