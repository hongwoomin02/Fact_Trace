import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware.js';

const savedOrigin = process.env.GEN_API_ORIGIN;
const savedToken = process.env.GEN_API_TOKEN;
afterEach(() => {
  if (savedOrigin === undefined) delete process.env.GEN_API_ORIGIN; else process.env.GEN_API_ORIGIN = savedOrigin;
  if (savedToken === undefined) delete process.env.GEN_API_TOKEN; else process.env.GEN_API_TOKEN = savedToken;
});

test('gateway keeps service key upstream and preserves video range requests', () => {
  process.env.GEN_API_ORIGIN = 'https://gpu.example.test';
  process.env.GEN_API_TOKEN = 'test-server-only-key';
  const response = middleware(new Request('https://site.example.test/api/generate/templates-static/demo.mp4', {
    headers: { range: 'bytes=0-63', authorization: 'Bearer attacker', cookie: 'private=1' },
  }));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://gpu.example.test/templates-static/demo.mp4');
  assert.equal(response.headers.get('x-middleware-request-authorization'), 'Bearer test-server-only-key');
  assert.equal(response.headers.get('x-middleware-request-range'), 'bytes=0-63');
  assert.equal(response.headers.get('x-middleware-request-cookie'), null);
  assert.equal(response.headers.get('authorization'), null);
});

test('gateway fails closed without server configuration', () => {
  delete process.env.GEN_API_TOKEN;
  assert.equal(middleware(new Request('https://site.example.test/api/generate/templates')).status, 503);
});

test('gateway rejects non-HTTPS upstream and routes outside the synthesis API', () => {
  process.env.GEN_API_ORIGIN = 'http://127.0.0.1:8002';
  process.env.GEN_API_TOKEN = 'test-key';
  assert.equal(middleware(new Request('https://site.example.test/api/generate/templates')).status, 503);
  assert.equal(middleware(new Request('https://site.example.test/api/generate/docs')).status, 404);
});

test('gateway rejects cross-origin synthesis submission before proxying', () => {
  process.env.GEN_API_ORIGIN = 'https://gpu.example.test';
  process.env.GEN_API_TOKEN = 'test-key';
  const response = middleware(new Request('https://site.example.test/api/generate/jobs', {
    method: 'POST', headers: { origin: 'https://other.example.test' },
  }));
  assert.equal(response.status, 403);
});
