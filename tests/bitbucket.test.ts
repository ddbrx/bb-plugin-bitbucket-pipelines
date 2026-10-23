import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization, launchBody, normalizePipeline, request } from '../bitbucket';
import { runInput, repositoryInput, pipelineInput } from '../contract';

test('launch encodes custom tag, commit and secured variables; rejects duplicates', () => {
  const input = runInput.parse({ ref: 'v1', refType: 'tag', custom: 'deploy', commit: 'abcdef1234', variables: [{ key: 'TOKEN', value: 'secret' }] });
  assert.deepEqual(launchBody(input), { target: { type: 'pipeline_ref_target', ref_type: 'tag', ref_name: 'v1', selector: { type: 'custom', pattern: 'deploy' }, commit: { type: 'commit', hash: 'abcdef1234' } }, variables: [{ key: 'TOKEN', value: 'secret', secured: true }] });
  assert.equal(runInput.safeParse({ ...input, variables: [...input.variables, ...input.variables] }).success, false);
});
test('rejects path traversal and invalid IDs before network access', () => {
  for (const repo of ['..', '.', 'x/y', 'x?foo', 'x%2Fy']) assert.equal(repositoryInput.safeParse({ repo }).success, false);
  assert.equal(pipelineInput.safeParse({ uuid: '../secrets' }).success, false);
});
test('authentication supports API tokens and bearer tokens', () => {
  assert.equal(authorization({ authMode: 'api-token', email: 'me@example.com', token: 'abc' }), `Basic ${Buffer.from('me@example.com:abc').toString('base64')}`);
  assert.equal(authorization({ authMode: 'bearer', email: '', token: 'abc' }), 'Bearer abc');
  assert.throws(() => authorization({ authMode: 'api-token', email: '', token: 'abc' }));
  assert.throws(() => authorization({ authMode: 'bearer', email: '' }));
});
test('normalizes status without exposing API variable values or arbitrary links', () => {
  const p = normalizePipeline({ uuid: '{123}', build_number: 4, state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } }, created_on: '2026-10-22', variables: [{ value: 'private' }], links: { html: { href: 'javascript:alert(1)' } } }, 'team', 'repo');
  assert.equal(p.result, 'SUCCESSFUL'); assert.equal(p.url, 'https://bitbucket.org/team/repo/pipelines/results/4'); assert.ok(!JSON.stringify(p).includes('private'));
});
test('requests use fixed API origin, block redirects, and never echo error bodies', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = (async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"error":{"message":"private-token"}}', { status: 403 }); }) as typeof fetch;
  try {
    await assert.rejects(request({ authMode: 'bearer', email: '', token: 'private-token' }, 'team/repo/pipelines/'), e => e instanceof Error && !e.message.includes('private-token') && e.message.includes('403'));
    assert.equal(calls[0].url, 'https://api.bitbucket.org/2.0/repositories/team/repo/pipelines/'); assert.equal(calls[0].options?.redirect, 'error');
  } finally { globalThis.fetch = original; }
});
test('POST network failure warns against duplicate launches; does not retry', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('private-token'); }) as typeof fetch;
  try { await assert.rejects(request({ authMode: 'bearer', email: '', token: 'abc' }, 'team/repo/pipelines/', 'POST', {}), /may have succeeded/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
