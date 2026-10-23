import { z } from 'zod';
import { pipelineSchema, stepSchema, runInput, type Pipeline } from './contract';
export type Credentials = { token?: string };
export function authorization(c: Credentials): string {
  if (!c.token?.trim()) throw new Error('Add a repository access token in Settings → Installed plugins → Bitbucket Pipelines.');
  return `Bearer ${c.token.trim()}`;
}
export function launchBody(input: z.infer<typeof runInput>) {
  return { target: { type: 'pipeline_ref_target', ref_type: input.refType, ref_name: input.ref,
    ...(input.custom ? { selector: { type: 'custom', pattern: input.custom } } : {}),
    ...(input.commit ? { commit: { type: 'commit', hash: input.commit } } : {}),
  }, variables: input.variables };
}
// Parse only the fields we expose. API responses may contain variable values: never return raw payloads.
const state = z.object({ name: z.string(), result: z.object({ name: z.string() }).nullish() });
const rawPipeline = z.object({ uuid: z.string(), build_number: z.number(), state,
  target: z.object({ ref_name: z.string().optional(), selector: z.object({ pattern: z.string().optional() }).optional(), commit: z.object({ hash: z.string().optional() }).optional() }).optional(),
  creator: z.object({ display_name: z.string().optional() }).optional(), created_on: z.string(), completed_on: z.string().nullish(), duration_in_seconds: z.number().nullish(),
});
export function normalizePipeline(raw: unknown, workspace: string, repo: string): Pipeline {
  const p = rawPipeline.parse(raw);
  return pipelineSchema.parse({ uuid: p.uuid, number: p.build_number, state: p.state.name, result: p.state.result?.name ?? null,
    ref: p.target?.ref_name ?? '', custom: p.target?.selector?.pattern ?? null, commit: p.target?.commit?.hash ?? '', creator: p.creator?.display_name ?? '',
    created: p.created_on, completed: p.completed_on ?? null, duration: p.duration_in_seconds ?? 0,
    url: `https://bitbucket.org/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pipelines/results/${p.build_number}` });
}
export const pageSchema = z.object({ values: z.array(z.unknown()).max(100), next: z.string().optional() });
export function normalizeStep(raw: unknown) {
  const s = z.object({ uuid: z.string(), name: z.string().optional(), state, duration_in_seconds: z.number().nullish() }).parse(raw);
  return stepSchema.parse({ uuid: s.uuid, name: s.name ?? 'Step', state: s.state.name, result: s.state.result?.name ?? null, duration: s.duration_in_seconds ?? 0 });
}
export async function request(credentials: Credentials, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const headers = { Authorization: authorization(credentials), Accept: 'application/json', 'Content-Type': 'application/json' };
  let response: Response;
  try {
    response = await fetch(`https://api.bitbucket.org/2.0/repositories/${path}`, { method, headers, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new Error(method === 'POST' ? 'Bitbucket request interrupted. Check pipeline status before retrying; the request may have succeeded.' : 'Could not reach Bitbucket. Check your connection and try again.');
  }
  if (!response.ok) {
    // Do not echo API error bodies: they can contain credentials or submitted secured variables.
    const hint = response.status === 401 ? 'Check that the repository access token is valid and has not expired.' : response.status === 403 ? 'Check repository access and pipeline read/write permissions.' : response.status === 404 ? 'Check workspace, repository and pipeline ID.' : response.status === 429 ? `Rate limited. Retry after ${response.headers.get('retry-after')?.replace(/[^0-9]/g, '').slice(0, 6) || 'a few'} seconds.` : 'Check the reference, custom pipeline name and repository pipeline configuration.';
    throw new Error(`Bitbucket HTTP ${response.status}. ${hint}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (Buffer.byteLength(text) > 2_000_000) throw new Error('Bitbucket response exceeds the size limit.');
  return text ? JSON.parse(text) : null;
}
