// Permanent redirect for every www request to the canonical apex origin,
// preserving path and query. One canonical origin per environment is a
// standing rule (auth cookies, CSP, SEO) — www must never serve content.
const CANONICAL_HOST = 'bidmorrow.com';

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
} satisfies ExportedHandler;
