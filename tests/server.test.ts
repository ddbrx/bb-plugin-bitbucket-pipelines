import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';

test('RPC, native tools and CLI share launch/status behavior without returning secrets', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'bitbucket-pipelines', settings: { authMode: 'bearer', token: 'private-token', workspace: 'team', repo: 'app' }, agentSkillIds: ['bitbucket-pipelines'] });
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

test('discovery works without repository defaults and keeps pagination on the fixed API origin', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'bitbucket-pipelines', settings: { authMode: 'bearer', token: 'secret' } });
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async url => {
    const path = String(url); urls.push(path);
    if (path.includes('user/workspaces')) return Response.json({ values: [{ workspace: { slug: 'team' } }], next: 'https://attacker.invalid/steal' });
    return Response.json({ values: [{ slug: 'app', name: 'Application', mainbranch: { name: 'develop' }, extra: 'not-exposed' }] });
  }) as typeof fetch;
  try {
    await plugin(bb);
    assert.deepEqual(await harness.behavior.callRpc('workspaces', {}), { workspaces: [{ slug: 'team', name: 'team' }], hasNext: true, page: 1 });
    assert.deepEqual(await harness.behavior.callRpc('repositories', { workspace: 'team', page: 2 }), { repositories: [{ workspace: 'team', slug: 'app', name: 'Application', branch: 'develop' }], hasNext: false, page: 2 });
    assert.equal(urls[0], 'https://api.bitbucket.org/2.0/user/workspaces?pagelen=50&page=1');
    assert.equal(urls[1], 'https://api.bitbucket.org/2.0/repositories/team?pagelen=50&sort=name&page=2');
    const cli = await harness.behavior.runCli(['repositories', '--workspace', 'team', '--json']);
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.ok(cli.stdout?.includes('develop'));
    const before = urls.length;
    await assert.rejects(harness.behavior.callRpc('repositories', { workspace: '..' }));
    assert.equal(urls.length, before);
    await harness.behavior.callAgentTool('bitbucket_pipelines_workspaces', {});
  } finally { globalThis.fetch = original; await harness.lifecycle.dispose(); }
});

test('discovery permission failure does not expose API error bodies or prevent manual pipeline use', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'bitbucket-pipelines', settings: { authMode: 'bearer', token: 'secret', workspace: 'team', repo: 'app' } });
  const original = globalThis.fetch;
  globalThis.fetch = (async url => String(url).includes('user/workspaces') ? new Response('private-token', { status: 403 }) : Response.json({ values: [] })) as typeof fetch;
  try {
    await plugin(bb);
    await assert.rejects(harness.behavior.callRpc('workspaces', {}), e => e instanceof Error && e.message.includes('403') && !e.message.includes('private-token'));
    assert.deepEqual(await harness.behavior.callRpc('list', {}), { pipelines: [], hasNext: false, page: 1 });
  } finally { globalThis.fetch = original; await harness.lifecycle.dispose(); }
});
