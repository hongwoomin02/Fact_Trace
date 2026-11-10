import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

async function moduleUrl(path, replacements = []) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText).toString('base64');
}
const typesUrl = await moduleUrl('../src/types/video.ts');
const { getManipulationScore, parseVideoResponse } = await import(typesUrl);
const { predictVideo } = await import(await moduleUrl('../src/services/videoApi.ts', [
  ["'../types/video'", JSON.stringify(typesUrl)], ['import.meta.env', '{}'],
]));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const fixture = () => ({
  api_version: '0.2.1', model: 'v6', device: 'cuda', video: 'sample.mp4', n_seeds: 3,
  n_frames_total: 30, n_frames_sampled: 10, n_frames_used: 0,
  verdict: 'UNKNOWN', video_margin: null, frames: [], warnings: [], timing_ms: { total: 12 },
});
const file = new File(['sample'], 'sample.mp4', { type: 'video/mp4' });

test('UNKNOWN never receives a score', () => {
  assert.equal(getManipulationScore({ ...fixture(), fake_score_display: 0.9 }), null);
});
test('score uses normalized API value and falls back for invalid values', () => {
  const r = { ...fixture(), verdict: 'REAL', video_margin: 0 };
  assert.equal(getManipulationScore({ ...r, fake_score_display: 0.2 }), 20);
  for (const invalid of [-1, 2, Infinity, NaN, undefined]) {
    assert.equal(getManipulationScore({ ...r, fake_score_display: invalid }), 50);
  }
  assert.equal(getManipulationScore({ ...r, video_margin: Infinity }), null);
});
test('malformed payloads fail before rendering', () => {
  for (const r of [null, {}, { ...fixture(), timing_ms: null },
    { ...fixture(), frames: [null] }, { ...fixture(), video_margin: '0' },
    { ...fixture(), verdict: 'invalid' }, { ...fixture(), warnings: [{}] }]) {
    assert.throws(() => parseVideoResponse(r), /응답/);
  }
  assert.equal(parseVideoResponse(fixture()).verdict, 'UNKNOWN');
});
test('uploads expected field and parses a complete response', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/video/predict?return_frames=true');
    assert.equal(options.body.get('file').name, 'sample.mp4');
    return Response.json(fixture());
  };
  assert.equal((await predictVideo(file)).result.model, 'v6');
});
test('pre-aborted request remains cancelled', async () => {
  globalThis.fetch = async (_, { signal }) => { signal.throwIfAborted(); };
  await assert.rejects(predictVideo(file, AbortSignal.abort()), /취소/);
});
test('cancellation while reading the response body is handled', async () => {
  const ac = new AbortController();
  globalThis.fetch = async (_, { signal }) => ({ ok: true, json: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    ac.abort();
  }) });
  await assert.rejects(predictVideo(file, ac.signal), /취소/);
});
test('timeout remains active until body consumption finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (_, { signal }) => ({ ok: true, json: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) });
  const pending = predictVideo(file);
  const rejected = assert.rejects(pending, /시간이 초과/);
  await Promise.resolve();
  t.mock.timers.tick(180_000);
  await rejected;
});
for (const status of [400, 413, 500, 502, 503, 504]) {
  test(`HTTP ${status} produces a controlled error`, async () => {
    globalThis.fetch = async () => Response.json({ detail: '/tmp/private/model-secret' }, { status });
    await assert.rejects(predictVideo(file), err => !err.message.includes('/tmp/private'));
  });
}
test('HTML success and network failures produce readable errors', async () => {
  globalThis.fetch = async () => new Response('<html>proxy error</html>');
  await assert.rejects(predictVideo(file), /JSON/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(predictVideo(file), /연결할 수 없습니다/);
});

const gen = await import(await moduleUrl('../src/lib/genApi.ts', [
  ['import.meta.env', "({VITE_GEN_API_BASE:'https://gen.example.test'})"],
  ['window.location.origin', "'https://frontend.example.test'"],
]));
test('generation relative result URLs resolve to the backend origin', async () => {
  globalThis.fetch = async () => Response.json({status:'done',result_url:'/jobs/123/result'});
  assert.equal((await gen.getJobStatus('123')).result_url, 'https://gen.example.test/jobs/123/result');
});
test('generation templates resolve preview URLs while preserving frontend thumbnails', async () => {
  globalThis.fetch = async () => Response.json([{id:'tpl_news',preview_url:'/templates-static/tpl_news.mp4',thumbnail_url:'/templates/thumb_news.svg'}]);
  const [template] = await gen.fetchTemplates();
  assert.equal(template.preview_url, 'https://gen.example.test/templates-static/tpl_news.mp4');
  assert.equal(template.thumbnail_url, '/templates/thumb_news.svg');
});
test('generation deletion reports HTTP and network failures', async () => {
  globalThis.fetch = async () => new Response('', {status:500});
  await assert.rejects(gen.deleteJob('123'), /삭제에 실패/);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(gen.deleteJob('123'), /offline/);
});
