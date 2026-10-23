import { cliCommand, defineCli, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { rpcContract, repositoryInput, listInput, runInput, pipelineInput, discoveryPageInput, repositoriesInput } from './contract';
import { authorization, launchBody, normalizePipeline, normalizeStep, pageSchema, request, requestApi, normalizeWorkspace, normalizeRepository } from './bitbucket';

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    authMode: { type: 'select', label: 'Authentication', options: ['api-token', 'bearer'], default: 'api-token' },
    email: { type: 'string', label: 'Atlassian account email (API token mode)', default: '' },
    token: { type: 'string', label: 'API token or repository/workspace access token', secret: true },
    workspace: { type: 'string', label: 'Default workspace slug', default: '' },
    repo: { type: 'string', label: 'Default repository slug', default: '' },
  });
  const lifetime = new AbortController();
  bb.onDispose(() => lifetime.abort());
  async function client(input: z.infer<typeof repositoryInput>, signal?: AbortSignal) {
    const s = await settings.get();
    authorization(s);
    if (!(input.workspace ?? s.workspace).trim() || !(input.repo ?? s.repo).trim()) throw new Error('Choose a workspace and repository in plugin settings, or pass --workspace and --repo.');
    const repo = repositoryInput.required().parse({ workspace: input.workspace ?? s.workspace, repo: input.repo ?? s.repo });
    const path = `${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pipelines/`;
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    return { ...repo, call: (suffix = '', method = 'GET', body?: unknown) => request(s, path + suffix, method, body, combined) };
  }
  const handlers = {
    workspaces: async (input: z.infer<typeof discoveryPageInput>, signal?: AbortSignal) => {
      const s = await settings.get();
      const page = pageSchema.parse(await requestApi(s, `user/workspaces?pagelen=50&page=${input.page}`, 'GET', undefined, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal));
      return { workspaces: page.values.map(normalizeWorkspace), hasNext: !!page.next, page: input.page };
    },
    repositories: async (input: z.infer<typeof repositoriesInput>, signal?: AbortSignal) => {
      const s = await settings.get();
      const page = pageSchema.parse(await request(s, `${encodeURIComponent(input.workspace)}?pagelen=50&sort=name&page=${input.page}`, 'GET', undefined, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal));
      return { repositories: page.values.map(r => normalizeRepository(r, input.workspace)), hasNext: !!page.next, page: input.page };
    },
    config: async () => { const s = await settings.get(); let configured = true; try { authorization(s); } catch { configured = false; }
      return { configured, workspace: s.workspace, repo: s.repo }; },
    list: async (input: z.infer<typeof listInput>, signal?: AbortSignal) => { const c = await client(input, signal); const page = pageSchema.parse(await c.call(`?pagelen=20&sort=-created_on&page=${input.page}`));
      return { pipelines: page.values.map(p => normalizePipeline(p, c.workspace, c.repo)), hasNext: !!page.next, page: input.page }; },
    run: async (input: z.infer<typeof runInput>, signal?: AbortSignal) => { const c = await client(input, signal); const result = normalizePipeline(await c.call('', 'POST', launchBody(input)), c.workspace, c.repo); bb.realtime.publish('pipelines-changed', null); return result; },
    get: async (input: z.infer<typeof pipelineInput>, signal?: AbortSignal) => { const c = await client(input, signal); return normalizePipeline(await c.call(encodeURIComponent(input.uuid)), c.workspace, c.repo); },
    steps: async (input: z.infer<typeof pipelineInput>, signal?: AbortSignal) => { const c = await client(input, signal); const page = pageSchema.parse(await c.call(`${encodeURIComponent(input.uuid)}/steps/?pagelen=100`)); return { steps: page.values.map(normalizeStep) }; },
    stop: async (input: z.infer<typeof pipelineInput>, signal?: AbortSignal) => { const c = await client(input, signal); await c.call(`${encodeURIComponent(input.uuid)}/stopPipeline`, 'POST'); bb.realtime.publish('pipelines-changed', null); return { stopped: true }; },
  };
  bb.rpc.register(rpcContract, {
    config: handlers.config,
    workspaces: (input) => handlers.workspaces(input),
    repositories: (input) => handlers.repositories(input),
    list: (input) => handlers.list(input),
    run: (input) => handlers.run(input),
    get: (input) => handlers.get(input),
    steps: (input) => handlers.steps(input),
    stop: (input) => handlers.stop(input),
  });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_run', description: 'Launch a Bitbucket Cloud branch, tag, or named custom pipeline. May deploy code. Use only when requested. Defaults to the repository in plugin settings. Variables default to secured.', parameters: runInput,
    execute: async (input, ctx) => JSON.stringify(await handlers.run(input, ctx.signal)) });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_list', description: 'List recent Bitbucket pipeline runs and status. Twenty results per page.', parameters: listInput,
    execute: async (input, ctx) => JSON.stringify(await handlers.list(input, ctx.signal)) });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_status', description: 'Read a Bitbucket pipeline status and steps by UUID or build number.', parameters: pipelineInput,
    execute: async (input, ctx) => JSON.stringify({ pipeline: await handlers.get(input), ...await handlers.steps(input, ctx.signal) }) });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_stop', description: 'Stop a Bitbucket pipeline when the user requests cancellation.', parameters: pipelineInput,
    execute: async (input, ctx) => JSON.stringify(await handlers.stop(input, ctx.signal)) });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_workspaces', description: 'Discover accessible Bitbucket workspaces. Requires workspace read permission. Fifty results per page.', parameters: discoveryPageInput,
    execute: async (input, ctx) => JSON.stringify(await handlers.workspaces(input, ctx.signal)) });
  bb.agents.registerTool({ name: 'bitbucket_pipelines_repositories', description: 'Discover repositories in a Bitbucket workspace. Requires repository read permission. Fifty results per page.', parameters: repositoriesInput,
    execute: async (input, ctx) => JSON.stringify(await handlers.repositories(input, ctx.signal)) });
  bb.agents.configure(() => ({ tools: ['bitbucket_pipelines_workspaces', 'bitbucket_pipelines_repositories', 'bitbucket_pipelines_run', 'bitbucket_pipelines_list', 'bitbucket_pipelines_status', 'bitbucket_pipelines_stop'], skills: ['bitbucket-pipelines'] }));
  const common = { workspace: { type: 'string' as const, description: 'Workspace slug; defaults to settings' }, repo: { type: 'string' as const, description: 'Repository slug; defaults to settings' }, json: { type: 'boolean' as const, description: 'Machine-readable JSON' } };
  const reply = (value: unknown) => ({ exitCode: 0, stdout: JSON.stringify(value, null, 2) });
  bb.cli.register(defineCli({ name: 'bitbucket-pipelines', summary: 'Launch and monitor Bitbucket Cloud pipelines', commands: {
    workspaces: cliCommand({ summary: 'Discover accessible workspaces', options: { json: common.json, page: { type: 'integer', min: 1, max: 10000, default: 1, description: 'Page number' } }, run: async (i, c) => reply(await handlers.workspaces({ page: i.options.page }, c.signal)) }),
    repositories: cliCommand({ summary: 'List repositories in a workspace', options: { workspace: { type: 'string', required: true, description: 'Workspace slug' }, json: common.json, page: { type: 'integer', min: 1, max: 10000, default: 1, description: 'Page number' } }, run: async (i, c) => { const { json, ...input } = i.options; return reply(await handlers.repositories(repositoriesInput.parse(input), c.signal)); } }),
    list: cliCommand({ summary: 'List recent runs', options: { ...common, page: { type: 'integer', min: 1, max: 10000, default: 1, description: 'Page number (1–10000)' } }, run: async (i, c) => { const { json, ...input } = i.options; return reply(await handlers.list(listInput.parse(input), c.signal)); } }),
    run: cliCommand({ summary: 'Launch a pipeline', options: { ...common, ref: { type: 'string', required: true, description: 'Branch or tag name' }, 'ref-type': { type: 'enum', values: ['branch', 'tag'], default: 'branch', description: 'Reference type' }, custom: { type: 'string', description: 'Custom pipeline name in bitbucket-pipelines.yml' }, commit: { type: 'string', description: 'Optional commit hash (7–40 hex characters)' }, variables: { type: 'string', stdin: true, description: 'JSON array of {key,value,secured}; prefer --variables-stdin for sensitive values' } },
      run: async (i, c) => { const { json, 'ref-type': refType, variables, ...rest } = i.options; return reply(await handlers.run(runInput.parse({ ...rest, refType, variables: variables ? JSON.parse(variables) : [] }), c.signal)); } }),
    get: cliCommand({ summary: 'Get status', positionals: [{ name: 'uuid', required: true, description: 'Pipeline UUID or build number' }], options: common, run: async (i, c) => { const { json, ...repo } = i.options; return reply(await handlers.get(pipelineInput.parse({ ...repo, uuid: i.positionals.uuid }), c.signal)); } }),
    steps: cliCommand({ summary: 'List steps', positionals: [{ name: 'uuid', required: true, description: 'Pipeline UUID or build number' }], options: common, run: async (i, c) => { const { json, ...repo } = i.options; return reply(await handlers.steps(pipelineInput.parse({ ...repo, uuid: i.positionals.uuid }), c.signal)); } }),
    stop: cliCommand({ summary: 'Stop a run', positionals: [{ name: 'uuid', required: true, description: 'Pipeline UUID or build number' }], options: common, run: async (i, c) => { const { json, ...repo } = i.options; return reply(await handlers.stop(pipelineInput.parse({ ...repo, uuid: i.positionals.uuid }), c.signal)); } }),
  } }));
}
