import { useEffect, useState } from 'preact/hooks';
import { BackupError, summarize, type ParsedBackup } from '../core/backupSchema';
import { GistError } from '../net/github';
import {
  backupNow,
  backupRunning,
  gistState,
  hasToken,
  maskedToken,
  relTime,
  removeToken,
  revisions,
  revisionText,
  saveToken,
  testToken,
  unlinkGist,
  type RevisionInfo,
} from '../state/gistBackup';
import { deviceLabel, restoreParsed, setLocal, validateBackup } from '../state/store';
import { confirmDialog, openModal, toast } from './dialogs';
import { go } from './router';

export function BackupStatusLine(props: { compact?: boolean }) {
  const st = gistState.value;
  if (!hasToken.value) return null;
  if (backupRunning.value) return <span class="muted small">Backing up…</span>;
  const err = st.lastError;
  if (err && (!st.lastSuccessAt || err.at > st.lastSuccessAt))
    return (
      <span class="small" style="color:var(--red)">
        ⚠︎ Gist backup failed{props.compact ? '' : ` (${new Date(err.at).toLocaleString()})`}: {err.message}
        {err.kind === 'rate' && err.resetAt ? ` Retry after ${new Date(err.resetAt).toLocaleTimeString()}.` : ''}
      </span>
    );
  if (st.lastSuccessAt)
    return (
      <span class="small" style="color:var(--green)">
        Last backup: {relTime(st.lastSuccessAt)} ✓{st.dirty ? <span class="muted"> · new changes pending</span> : ''}
      </span>
    );
  return <span class="muted small">No Gist backup yet.</span>;
}

function TokenHelp() {
  return (
    <details class="small" style="margin:8px 0">
      <summary style="cursor:pointer;color:var(--blue)">How do I create this?</summary>
      <ol style="padding-left:18px;line-height:1.6">
        <li>On github.com, tap your profile picture → <b>Settings</b>.</li>
        <li>Scroll to the bottom → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b>.</li>
        <li>Tap <b>Generate new token</b>. Name it e.g. “Repertoire Trainer backup”.</li>
        <li>
          <b>Expiration:</b> 90 days is a good balance (you’ll create a new one when it expires — the app tells you).
        </li>
        <li>
          <b>Repository access:</b> leave it at “Public repositories (read-only)” — no repository access is needed.
        </li>
        <li>
          Under <b>Permissions → Account permissions</b>, set <b>Gists</b> to <b>Read and write</b>. Leave everything else at
          “No access”.
        </li>
        <li>Tap <b>Generate token</b>, copy it (it starts with <code>github_pat_</code>) and paste it here.</li>
      </ol>
      <p class="muted">
        The token is stored only in this app’s storage on this device. It is never included in exports, backups or
        snapshots, and is only ever sent to api.github.com. The backup Gist is <b>secret</b> (unlisted): only people with its
        link can see it, so don’t share the link.
      </p>
    </details>
  );
}

export function GistSettings() {
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState('');
  const st = gistState.value;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      await confirmDialog((e as Error).message, { title: e instanceof GistError ? 'GitHub' : 'Error' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div class="card">
      <h2>GitHub Gist backup</h2>
      <p class="muted small">
        Automatic backups to a secret Gist on your GitHub account, after each practice or build session and when the app goes
        to the background (only when something changed, at most every 5 minutes). GitHub keeps every revision.
      </p>
      {hasToken.value ? (
        <>
          <div class="row" style="margin-bottom:8px">
            <code class="grow small" style="overflow:hidden;text-overflow:ellipsis">{maskedToken()}</code>
            <button
              class="btn small danger"
              onClick={async () => {
                if (await confirmDialog('Remove the GitHub token from this device? Automatic backups stop.', { ok: 'Remove', danger: true }))
                  await removeToken();
              }}
            >
              Remove token
            </button>
          </div>
          <div style="margin-bottom:8px">
            <BackupStatusLine />
          </div>
          <div class="row wrap">
            <button class="btn primary grow" disabled={!!busy || backupRunning.value} onClick={() => run('backup', () => backupNow().then(() => toast('Backed up to Gist ✓')))}>
              {busy === 'backup' || backupRunning.value ? 'Backing up…' : 'Back up now'}
            </button>
            <button class="btn grow" disabled={!!busy} onClick={() => run('test', async () => toast(await testToken(), 3500))}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          <button class="btn block" style="margin-top:8px" disabled={!!busy} onClick={() => openModal((close) => <GistRestore close={close} />)}>
            Restore from Gist…
          </button>
          <div class="field">
            <label>Include Lichess games in Gist backups</label>
            <div class="chips">
              {[false, true].map((v) => (
                <button class={`chip ${!!st.includeGames === v ? 'on' : ''}`} onClick={() => setLocal('local:gist', { ...st, includeGames: v })}>
                  {v ? 'Yes' : 'No (smaller — games can be re-synced)'}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <label>Device name (shown in backups)</label>
            <input
              style="width:100%"
              value={deviceLabel()}
              maxLength={40}
              onChange={(e) => setLocal('local:deviceLabel', (e.target as HTMLInputElement).value.trim())}
            />
          </div>
          {st.gistId && (
            <p class="small muted">
              Gist id <code>{st.gistId.slice(0, 8)}…</code>{' '}
              <button class="btn small ghost" onClick={async () => (await confirmDialog('Stop using this Gist? The next backup finds or creates one again.')) && unlinkGist()}>
                Unlink
              </button>
            </p>
          )}
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await run('save', async () => {
              toast(await saveToken(tok), 3500);
              setTok('');
            });
          }}
        >
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            placeholder="Paste a fine-grained token (github_pat_…)"
            style="width:100%"
            value={tok}
            onInput={(e) => setTok((e.target as HTMLInputElement).value)}
          />
          <button class="btn primary block" style="margin-top:8px" disabled={!tok.trim() || !!busy}>
            {busy === 'save' ? 'Checking…' : 'Save token'}
          </button>
        </form>
      )}
      <TokenHelp />
    </div>
  );
}

function GistRestore(props: { close: () => void }) {
  const [list, setList] = useState<RevisionInfo[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ rev: RevisionInfo; parsed: ParsedBackup } | null>(null);
  const [loading, setLoading] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const l = await revisions();
        if (cancelled) return;
        setList(l);
        // Load summaries for the newest few, one request at a time.
        for (const r of l.slice(0, 8)) {
          if (cancelled) return;
          try {
            const p = validateBackup(await revisionText(r.version));
            setSummaries((s) => ({ ...s, [r.version]: `${summarize(p.data)}${p.meta.deviceLabel ? ` · ${p.meta.deviceLabel}` : ''}` }));
          } catch (e) {
            setSummaries((s) => ({ ...s, [r.version]: `⚠︎ ${(e as Error).message.split('\n')[0]}` }));
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (r: RevisionInfo) => {
    setLoading(r.version);
    try {
      setPreview({ rev: r, parsed: validateBackup(await revisionText(r.version)) });
    } catch (e) {
      setError(e instanceof BackupError ? `This revision can’t be restored: ${e.message}` : (e as Error).message);
    } finally {
      setLoading('');
    }
  };

  if (preview) {
    const { parsed, rev } = preview;
    const d = parsed.data;
    return (
      <div>
        <h3>Restore this backup?</h3>
        <p class="small">
          From <b>{new Date(rev.date).toLocaleString()}</b>
          {parsed.meta.deviceLabel ? ` (${parsed.meta.deviceLabel}, app ${parsed.meta.appVersion})` : ''}
        </p>
        <ul class="small">
          {d.repertoires.map((r) => (
            <li>
              {r.side === 'w' ? '♔' : '♚'} {r.name}: {d.moves.filter((m) => m.repertoireId === r.id).length} moves
            </li>
          ))}
          <li>{d.cards.length} practice cards · {d.reviewLogs.length} reviews</li>
          <li>{parsed.meta.gamesIncluded ? `${d.lichessGames.length} Lichess games` : 'Lichess games not included (yours on this device are kept)'} · {d.findings.length} findings</li>
        </ul>
        {parsed.warnings.length > 0 && <p class="small muted">Notes: {parsed.warnings.join(' ')}</p>}
        <p class="small muted">This replaces everything on this device. Your current data is saved as a snapshot first, so you can undo it.</p>
        <div class="row">
          <button class="btn grow" onClick={() => setPreview(null)}>Back</button>
          <button
            class="btn danger grow"
            onClick={async () => {
              props.close();
              await restoreParsed(parsed, 'Before restoring from Gist');
              go('');
              toast('Restored from Gist ✓', 3000);
            }}
          >
            Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3>Restore from Gist</h3>
      {error && <p class="small" style="color:var(--red)">{error}</p>}
      {!list && !error && <p class="muted small">Loading revisions…</p>}
      {list?.map((r) => (
        <div class="list-item" style="cursor:pointer" onClick={() => pick(r)}>
          <div class="grow" style="min-width:0">
            <div class="small" style="font-weight:600">{new Date(r.date).toLocaleString()}</div>
            <div class="small muted">{summaries[r.version] ?? `${r.changes} lines changed`}</div>
          </div>
          <span class="muted">{loading === r.version ? '…' : '›'}</span>
        </div>
      ))}
      <button class="btn block ghost" style="margin-top:8px" onClick={props.close}>Cancel</button>
    </div>
  );
}
