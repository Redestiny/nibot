import type { MiddlewareHandler } from 'hono';

// The API binds to loopback only, but "loopback" is not an access control:
// any page the user visits can issue cross-site requests to 127.0.0.1, and a
// POST with `content-type: text/plain` is a CORS "simple request" that skips
// preflight entirely. Without this guard an arbitrary web page could add a
// provider pointing at its own base_url and then trigger a generation, which
// ships the book's settings and prose to that endpoint.
//
// Two checks cover the two attacks:
//   - The authority must be a loopback name. A DNS-rebinding page reaches us
//     under its own hostname, so this rejects it (and denies it the same-origin
//     read access rebinding is used for).
//   - Origin, when present, must match that authority exactly. Cross-site
//     requests carry the attacker's origin; same-origin ones (the GUI itself,
//     and the Vite dev proxy, which forwards both headers untouched) match.
//
// Top-level navigations send no Origin, so opening the GUI from a link still
// works — and a cross-site GET cannot read the response anyway.

// `URL.hostname` keeps the brackets on IPv6 literals ("[::1]").
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function createLocalOriginGuard(): MiddlewareHandler {
  return async (c, next) => {
    // @hono/node-server derives the request URL from the Host header (or the
    // HTTP/2 :authority), so these normally agree. They diverge only for an
    // absolute-form request-target, which no browser sends to an origin
    // server — checking both closes that gap anyway.
    const urlHost = parseUrl(c.req.url)?.host;
    const headerHost = c.req.header('host');

    for (const candidate of [urlHost, headerHost]) {
      if (candidate !== undefined && !isLoopbackHost(candidate)) {
        return forbidden(
          c,
          'FORBIDDEN_HOST',
          `Requests must address the server as a loopback host. Received "${candidate}".`,
        );
      }
    }

    const authority = headerHost ?? urlHost;
    const origin = c.req.header('origin');

    if (origin !== undefined && (authority === undefined || !isSameOrigin(origin, authority))) {
      return forbidden(
        c,
        'FORBIDDEN_ORIGIN',
        `Cross-site requests are not allowed. Received Origin "${origin}".`,
      );
    }

    return next();
  };
}

function forbidden(
  c: Parameters<MiddlewareHandler>[0],
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } }, 403);
}

function isLoopbackHost(host: string): boolean {
  const hostname = parseHostname(host);
  return hostname !== null && LOOPBACK_HOSTNAMES.has(hostname);
}

function isSameOrigin(origin: string, host: string): boolean {
  const originUrl = parseUrl(origin);
  if (!originUrl || !LOOPBACK_HOSTNAMES.has(originUrl.hostname)) {
    return false;
  }

  // `URL` drops the port when it is the protocol default, which is exactly how
  // browsers build the Host header too, so the two stay comparable.
  const hostUrl = parseUrl(`${originUrl.protocol}//${host}`);
  return hostUrl !== null && hostUrl.host === originUrl.host;
}

function parseHostname(host: string): string | null {
  return parseUrl(`http://${host}`)?.hostname ?? null;
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    // `new URL('http://')` and friends parse with an empty host; reject those
    // rather than letting them compare equal to another empty host.
    return url.hostname.length > 0 ? url : null;
  } catch {
    return null;
  }
}
