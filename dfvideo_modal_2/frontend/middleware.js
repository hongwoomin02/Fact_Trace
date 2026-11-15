import { rewrite } from '@vercel/functions';

export const config = { matcher: ['/api/generate/:path*'] };

export default function middleware(request) {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice('/api/generate'.length);
  const job = '/jobs/job_[a-f0-9]{32}';
  const read = /^(GET|HEAD)$/.test(request.method) && (
    /^\/(health|templates)$/.test(path) || /^\/templates-static\/[^/]+$/.test(path) ||
    new RegExp(`^${job}(/result)?$`).test(path)
  );
  const create = request.method === 'POST' && path === '/jobs';
  const remove = request.method === 'DELETE' && new RegExp(`^${job}$`).test(path);
  if (!read && !create && !remove) return Response.json({ message: 'Not found' }, { status: 404 });

  const origin = process.env.GEN_API_ORIGIN;
  const token = process.env.GEN_API_TOKEN;
  if (!origin || !token) return Response.json({ message: 'GPU API is not configured' }, { status: 503 });
  let target;
  try {
    const upstream = new URL(origin);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password) throw new Error();
    target = new URL(path + incoming.search, upstream.origin);
  } catch {
    return Response.json({ message: 'GPU API configuration is invalid' }, { status: 503 });
  }
  if ((create || remove) && request.headers.get('origin') && request.headers.get('origin') !== incoming.origin) {
    return Response.json({ message: 'Origin is not allowed' }, { status: 403 });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'accept', 'range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${token}`);
  return rewrite(target, {
    request: { headers },
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
