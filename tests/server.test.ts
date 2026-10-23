import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';

test('RPC, native tools and CLI share launch/status behavior without returning secrets', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'bitbucket-pipelines', settings: { token: 'private-token', workspace: 'team', repo: 'app' }, agentSkillIds: ['bitbucket-pipelines'] });
  const original = globalThis.fetch;
  const requests: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = (async (url, options) => {
    requests.push({ url: String(url), options });
    const pipeline = { uuid: '{12345678-1234-1234-1234-123456789abc}', build_number: 7, state: { name: 'IN_PROGRESS' }, created_on: '2026-10-22T00:00:00Z', target: { ref_name: 'main' }, variables: [{ value: 'private-value' }] };
    return Response.json(options?.method === 'POST' || !String(url).includes('?') ? pipeline : { values: [pipeline] });
  }) as typeof fetch;
  try {
    await plugin(bb);
    assert.deepEqual(await harness.behavior.callRpc('config', null), { configured: true, workspace: 'team', repo: 'app' });
    const run = await harness.behavior.callRpc('run', { ref: 'main', variables: [{ key: 'TOKEN', value: 'private-value' }] });
    assert.equal((run as {number: number}).number, 7);
    assert.ok(!JSON.stringify(run).includes('private-value'));
    assert.equal(JSON.parse(String(requests[0].options?.body)).variables[0].secured, true);
    const list = await harness.behavior.runCli(['list', '--json']);
    assert.equal(list.exitCode, 0, list.stderr); assert.ok(list.stdout?.includes('IN_PROGRESS'));
    const launch = await harness.behavior.runCli(['run', '--ref', 'main', '--custom', 'deploy', '--json']);
    assert.equal(launch.exitCode, 0, launch.stderr);
    const invalid = await harness.behavior.runCli(['run', '--ref', 'main', '--unknown', '--json']);
    assert.notEqual(invalid.exitCode, 0);
    await harness.behavior.callAgentTool('bitbucket_pipelines_list', {});
    const before = requests.length;
    await assert.rejects(harness.behavior.callRpc('list', { repo: '../private' }));
    assert.equal(requests.length, before);
    await harness.behavior.setSettings({ token: 'updated-token' });
    await harness.behavior.callRpc('list', {});
    assert.equal((requests.at(-1)?.options?.headers as Record<string, string>).Authorization, 'Bearer updated-token');
  } finally { globalThis.fetch = original; await harness.lifecycle.dispose(); }
});
test('uses only public SDK imports', async () => {
  const scan = await experimental_scanPublicSdkOnly(new URL('..', import.meta.url).pathname, { allow: [/^react(?:-dom)?$/, /^@radix-ui\//, /^class-variance-authority$/, /^clsx$/, /^tailwind-merge$/] });
  assert.deepEqual(scan.violations, []); assert.deepEqual(scan.privateDependencies, []);
});

test('repository settings persist and repository-scoped calls need no workspace discovery', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'bitbucket-pipelines', settings: { token: 'repo-token', authMode: 'api-token', email: 'old@example.com' } });
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url, options) => {
    urls.push(String(url));
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer repo-token');
    return Response.json({ values: [] });
  }) as typeof fetch;
  try {
    await plugin(bb);
    assert.deepEqual(await harness.behavior.callRpc('config', null), { configured: true, workspace: '', repo: '' });
    await harness.behavior.callRpc('saveRepository', { workspace: 'team', repo: 'app' });
    assert.deepEqual(await harness.behavior.callRpc('config', null), { configured: true, workspace: 'team', repo: 'app' });
    assert.deepEqual(await harness.behavior.callRpc('list', {}), { pipelines: [], hasNext: false, page: 1 });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^https:\/\/api\.bitbucket\.org\/2\.0\/repositories\/team\/app\/pipelines\//);
    await assert.rejects(harness.behavior.callRpc('saveRepository', { workspace: '..', repo: 'app' }));
    const next = await harness.lifecycle.reload(plugin);
    try {
      assert.deepEqual(await next.harness.behavior.callRpc('config', null), { configured: true, workspace: 'team', repo: 'app' });
    } finally { await next.harness.lifecycle.dispose(); }
  } finally { globalThis.fetch = original; await harness.lifecycle.dispose(); }
});
