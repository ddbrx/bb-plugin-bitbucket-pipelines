import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { definePluginApp, useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract, Pipeline, Repository } from './contract';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Icon } from './components/ui/icon';

type Step = { uuid: string; name: string; state: string; result: string | null; duration: number };
function Status({ state, result }: { state: string; result: string | null }) {
  const label = result ?? state;
  return <span className={`inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs font-medium ${label === 'FAILED' || label === 'ERROR' ? 'text-destructive' : 'text-foreground'}`}><span aria-hidden className={`size-1.5 rounded-full bg-current ${state === 'IN_PROGRESS' ? 'animate-pulse' : ''}`} />{label.replaceAll('_', ' ')}</span>;
}
function duration(seconds: number) { return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`; }
function Dashboard() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [config, setConfig] = useState<{ configured: boolean; workspace: string; repo: string } | null>(null);
  const [workspace, setWorkspace] = useState(''); const [repo, setRepo] = useState('');
  const [workspaces, setWorkspaces] = useState<{ slug: string; name: string }[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [workspacePage, setWorkspacePage] = useState(1); const [repoPage, setRepoPage] = useState(1);
  const [moreWorkspaces, setMoreWorkspaces] = useState(false); const [moreRepos, setMoreRepos] = useState(false);
  const [workspaceError, setWorkspaceError] = useState(''); const [repoError, setRepoError] = useState('');
  const [discoveringWorkspaces, setDiscoveringWorkspaces] = useState(false); const [discoveringRepos, setDiscoveringRepos] = useState(false);
  const [discoveryRetry, setDiscoveryRetry] = useState(0);
  const [discoveryWorkspace, setDiscoveryWorkspace] = useState('');
  const [active, setActive] = useState<{ workspace: string; repo: string } | null>(null);
  const [runs, setRuns] = useState<Pipeline[] | null>(null); const [page, setPage] = useState(1); const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [updated, setUpdated] = useState('');
  const [ref, setRef] = useState('main'); const [refType, setRefType] = useState<'branch' | 'tag'>('branch'); const [custom, setCustom] = useState(''); const [commit, setCommit] = useState('');
  const [variables, setVariables] = useState<{ key: string; value: string; secured: boolean }[]>([]);
  const [selected, setSelected] = useState<Pipeline | null>(null); const [steps, setSteps] = useState<Step[] | null>(null); const [stepError, setStepError] = useState('');
  const generation = useRef(0);
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  useEffect(() => { let live = true; rpc.call('config').then(c => { if (!live) return; setConfig(c); setWorkspace(c.workspace); setRepo(c.repo); if (c.configured && c.workspace && c.repo) setActive({ workspace: c.workspace, repo: c.repo }); }, e => { if (live) report(e); }); return () => { live = false; }; }, [rpc]);
  useEffect(() => {
    if (!config?.configured) return;
    let live = true; setDiscoveringWorkspaces(true); setWorkspaceError('');
    rpc.call('workspaces', { page: workspacePage }).then(data => {
      if (!live) return;
      setWorkspaces(previous => workspacePage === 1 ? data.workspaces : [...previous, ...data.workspaces.filter(w => !previous.some(p => p.slug === w.slug))]);
      setMoreWorkspaces(data.hasNext);
      if (workspacePage === 1) setDiscoveryWorkspace(previous => previous || config.workspace || data.workspaces[0]?.slug || '');
    }, e => { if (live) setWorkspaceError(`Workspace discovery unavailable. Check workspace read permission, or enter a workspace below. ${e instanceof Error ? e.message : ''}`); }).finally(() => { if (live) setDiscoveringWorkspaces(false); });
    return () => { live = false; };
  }, [rpc, config, workspacePage, discoveryRetry]);
  useEffect(() => {
    if (!config?.configured || !discoveryWorkspace) return;
    let live = true; setDiscoveringRepos(true); setRepoError('');
    rpc.call('repositories', { workspace: discoveryWorkspace, page: repoPage }).then(data => {
      if (!live) return;
      setRepositories(previous => repoPage === 1 ? data.repositories : [...previous, ...data.repositories.filter(r => !previous.some(p => p.slug === r.slug))]);
      setMoreRepos(data.hasNext);
    }, e => { if (live) setRepoError(`Repository discovery unavailable. Check repository read permission, or enter the repository below. ${e instanceof Error ? e.message : ''}`); }).finally(() => { if (live) setDiscoveringRepos(false); });
    return () => { live = false; };
  }, [rpc, config, discoveryWorkspace, repoPage, discoveryRetry]);
  const chooseWorkspace = (value: string) => { setDiscoveryWorkspace(value); setWorkspace(value); setRepo(''); setRepositories([]); setRepoPage(1); setMoreRepos(false); };
  const chooseRepository = (slug: string) => {
    const choice = repositories.find(r => r.slug === slug); if (!choice) return;
    generation.current++; setRuns(null); setSelected(null); setUpdated(''); setPage(1); setVariables([]);
    setWorkspace(choice.workspace); setRepo(choice.slug); setRef(choice.branch || 'main'); setActive({ workspace: choice.workspace, repo: choice.slug });
  };
  const refresh = useCallback(async () => {
    if (!active) return;
    const version = ++generation.current;
    setLoading(true);
    try { const data = await rpc.call('list', { ...active, page }); if (version !== generation.current) return; setRuns(data.pipelines); setHasNext(data.hasNext); setError(''); setUpdated(new Date().toLocaleTimeString()); }
    catch (e) { if (version === generation.current) report(e); }
    finally { if (version === generation.current) setLoading(false); }
  }, [rpc, active, page]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000); return () => { clearInterval(timer); generation.current++; }; }, [refresh]);
  useRealtime('pipelines-changed', () => { void refresh(); });
  const loadSteps = useCallback(async () => {
    if (!selected || !active) return;
    const data = await rpc.call('steps', { ...active, uuid: selected.uuid }); return data.steps;
  }, [rpc, selected, active]);
  useEffect(() => { let live = true; setSteps(null); setStepError(''); const load = () => { loadSteps().then(s => { if (live && s) { setSteps(s); setStepError(''); } }, e => { if (live) setStepError(e instanceof Error ? e.message : String(e)); }); }; load(); const timer = setInterval(load, 15000); return () => { live = false; clearInterval(timer); }; }, [loadSteps]);
  const launch = async (e: FormEvent) => {
    e.preventDefault(); if (!active || busy) return; setBusy(true); setError('');
    try { const result = await rpc.call('run', { ...active, ref, refType, ...(custom.trim() ? { custom: custom.trim() } : {}), ...(commit.trim() ? { commit: commit.trim() } : {}), variables }); setVariables([]); setSelected(result); setPage(1); await refresh(); }
    catch (e) { report(e); } finally { setBusy(false); }
  };
  const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return <div className="h-full overflow-y-auto bg-background text-foreground"><div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Bitbucket Cloud</p><h1 className="text-2xl font-semibold tracking-tight">Pipeline control room</h1><p className="mt-2 text-sm text-muted-foreground">Launch builds. Follow deployments. Keep work moving.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={!active || loading}><Icon name="RefreshCw" className="size-4" />{loading ? 'Refreshing…' : 'Refresh'}</Button></header>
    {config && !config.configured && <div className="rounded-xl border border-border bg-card p-5"><h2 className="font-medium">Connect Bitbucket</h2><p className="mt-2 text-sm text-muted-foreground">Open Settings → Installed plugins → Bitbucket Pipelines. Set your authentication mode and secret token. API tokens also require your Atlassian account email. Reopen this dashboard after saving.</p></div>}
    {config?.configured && <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Choose a repository</h2><Button type="button" variant="ghost" size="sm" onClick={() => { setWorkspacePage(1); setRepoPage(1); setDiscoveryRetry(n => n + 1); }}>Reload choices</Button></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs font-medium">Available workspaces<select aria-label="Available workspaces" className={selectClass} value={discoveryWorkspace} disabled={discoveringWorkspaces} onChange={e => chooseWorkspace(e.target.value)}><option value="">{discoveringWorkspaces ? 'Loading workspaces…' : 'Choose workspace'}</option>{discoveryWorkspace && !workspaces.some(w => w.slug === discoveryWorkspace) && <option value={discoveryWorkspace}>{discoveryWorkspace}</option>}{workspaces.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}</select></label>
      <label className="space-y-2 text-xs font-medium">Available repositories<select aria-label="Available repositories" className={selectClass} value={active?.workspace === discoveryWorkspace ? active.repo : ''} disabled={discoveringRepos || !discoveryWorkspace} onChange={e => chooseRepository(e.target.value)}><option value="">{discoveringRepos ? 'Loading repositories…' : repositories.length ? 'Choose repository' : 'No repositories loaded'}</option>{active?.workspace === discoveryWorkspace && !repositories.some(r => r.slug === active.repo) && <option value={active.repo}>{active.repo}</option>}{repositories.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select></label></div>
      <div className="flex flex-wrap gap-2">{moreWorkspaces && <Button variant="outline" size="sm" disabled={discoveringWorkspaces} onClick={() => setWorkspacePage(n => n + 1)}>More workspaces</Button>}{moreRepos && <Button variant="outline" size="sm" disabled={discoveringRepos} onClick={() => setRepoPage(n => n + 1)}>More repositories</Button>}</div>
      {(workspaceError || repoError) && <p role="status" className="text-xs text-muted-foreground">{workspaceError} {repoError}</p>}
      <details><summary className="cursor-pointer text-xs text-muted-foreground">Enter workspace manually</summary><form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); chooseWorkspace(workspace.trim()); }}><Input aria-label="Workspace for discovery" required value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="Workspace slug" /><Button type="submit" variant="outline">Find repositories</Button></form></details>
    </section>}
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4" onSubmit={e => { e.preventDefault(); setRuns(null); setSelected(null); setPage(1); setActive({ workspace: workspace.trim(), repo: repo.trim() }); }}>
      <label className="min-w-40 flex-1 space-y-2 text-xs font-medium">Workspace<Input required value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="your-workspace" /></label>
      <label className="min-w-40 flex-1 space-y-2 text-xs font-medium">Repository<Input required value={repo} onChange={e => setRepo(e.target.value)} placeholder="repository-slug" /></label>
      <Button type="submit" variant="outline" disabled={!config?.configured}>Load repository</Button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>}
    <div className="grid items-start gap-6 lg:grid-cols-3"><section className="rounded-xl border border-border bg-card p-5 lg:col-span-1"><h2 className="font-semibold">Launch pipeline</h2><p className="mt-1 text-xs text-muted-foreground">Uses this repository’s bitbucket-pipelines.yml.</p>
      <form onSubmit={launch} className="mt-5 space-y-4">
        <label className="block space-y-2 text-xs font-medium">Reference type<select className={selectClass} value={refType} onChange={e => setRefType(e.target.value as 'branch' | 'tag')}><option value="branch">Branch</option><option value="tag">Tag</option></select></label>
        <label className="block space-y-2 text-xs font-medium">{refType === 'branch' ? 'Branch' : 'Tag'}<Input required maxLength={256} value={ref} onChange={e => setRef(e.target.value)} /></label>
        <label className="block space-y-2 text-xs font-medium">Custom pipeline <span className="text-muted-foreground">· optional</span><Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. deploy-staging" maxLength={256} /></label>
        <label className="block space-y-2 text-xs font-medium">Commit <span className="text-muted-foreground">· optional</span><Input value={commit} onChange={e => setCommit(e.target.value)} placeholder="Commit hash" pattern="[a-fA-F0-9]{7,40}" /></label>
        <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-xs font-medium">Runtime variables</span><Button type="button" size="sm" variant="ghost" disabled={variables.length >= 50} onClick={() => setVariables(v => [...v, { key: '', value: '', secured: true }])}>+ Add</Button></div>
          {variables.map((v, index) => <div key={index} className="space-y-2 rounded-lg border border-border p-3"><Input aria-label={`Variable ${index + 1} key`} placeholder="VARIABLE_NAME" required pattern="[A-Za-z_][A-Za-z0-9_]*" value={v.key} onChange={e => setVariables(items => items.map((x, n) => n === index ? { ...x, key: e.target.value } : x))} /><Input aria-label={`Variable ${index + 1} value`} placeholder="Value" type={v.secured ? 'password' : 'text'} value={v.value} onChange={e => setVariables(items => items.map((x, n) => n === index ? { ...x, value: e.target.value } : x))} /><div className="flex items-center justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={v.secured} onChange={e => setVariables(items => items.map((x, n) => n === index ? { ...x, secured: e.target.checked } : x))} />Secured</label><Button type="button" variant="ghost" size="sm" onClick={() => setVariables(items => items.filter((_, n) => n !== index))}>Remove</Button></div></div>)}
        </div><Button className="w-full" type="submit" disabled={busy || !active || !config?.configured || !ref.trim()}><Icon name="Play" className="size-4" />{busy ? 'Launching…' : 'Launch pipeline'}</Button>
      </form></section>
      <section className="min-w-0 space-y-4 lg:col-span-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Recent runs</h2><span className="text-xs text-muted-foreground">{updated ? `Updated ${updated} · every 15s` : 'Auto-refresh every 15s'}</span></div>
        {runs?.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{runs.map(p => <button type="button" key={p.uuid} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2" onClick={() => setSelected(p)}><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-semibold">#{p.number}</span><span className="truncate text-sm">{p.custom || p.ref || 'Pipeline'}</span></div><p className="mt-2 text-xs text-muted-foreground">{p.ref} · {p.commit.slice(0, 7)} · {new Date(p.created).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{p.creator}{p.duration ? ` · ${duration(p.duration)}` : ''}</p></div><Status state={p.state} result={p.result} /></button>)}</div> : <div role="status" className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{!active ? 'Select a repository to see its pipelines.' : runs === null ? loading ? 'Loading pipelines…' : 'Pipeline results will appear here.' : 'No pipeline runs yet. Launch the first one.'}</div>}
        {runs && <div className="flex items-center justify-between"><Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => { setSelected(null); setPage(p => p - 1); }}>Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button variant="outline" size="sm" disabled={!hasNext || loading} onClick={() => { setSelected(null); setPage(p => p + 1); }}>Next</Button></div>}
        {selected && <div className="space-y-4 rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Run #{selected.number} · Steps</h3><Button variant="outline" size="sm" onClick={() => navigate.openUrl(selected.url)}>Open in Bitbucket <Icon name="ExternalLink" className="size-3" /></Button></div>{stepError ? <p role="alert" className="text-sm text-destructive">{stepError}</p> : steps === null ? <p role="status" className="text-sm text-muted-foreground">Loading steps…</p> : steps.length === 0 ? <p className="text-sm text-muted-foreground">Waiting for steps.</p> : <ul className="space-y-3">{steps.map(s => <li key={s.uuid} className="flex items-center justify-between gap-3 text-sm"><div>{s.name}<span className="ml-2 text-xs text-muted-foreground">{duration(s.duration)}</span></div><Status state={s.state} result={s.result} /></li>)}</ul>}
          {['PENDING', 'IN_PROGRESS'].includes((runs?.find(p => p.uuid === selected.uuid) ?? selected).state) && <Button variant="outline" size="sm" disabled={busy} onClick={async () => { if (!active) return; setBusy(true); try { await rpc.call('stop', { ...active, uuid: selected.uuid }); await refresh(); } catch (e) { report(e); } finally { setBusy(false); } }}>Stop pipeline</Button>}
        </div>}
      </section></div>
  </div></div>;
}
export default definePluginApp(app => {
  app.slots.navPanel({ id: 'pipelines', title: 'Bitbucket Pipelines', icon: 'GitBranch', path: 'pipelines', component: Dashboard });
});
