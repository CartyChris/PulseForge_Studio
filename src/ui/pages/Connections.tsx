/** Connect — AI subscriptions (your logged-in CLIs), local models, one-click OAuth and API keys. */
import { useEffect, useState } from "react";
import { useStudio } from "../../state/store";
import { api, serverMode, detectServerMode, type ConnectionsReport, type ProviderInfo } from "../../api";
import { useProducer } from "../../ai/useProducer";
import { startOpenRouterBrowserOAuth } from "../../ai/oauth-client";
import { getHost } from "../../host/adapter";
import { Icon } from "../shell/Icons";
import { Coach, ShowAt } from "../shell/Level";
import { ProviderSetup } from "../AIAssistant";

const LOGIN_HINT: Record<string, string> = {
  "cli-claude": "Run `claude` in Terminal and use /login once.",
  "cli-codex": "Run `codex` in Terminal and sign in with ChatGPT once.",
  "cli-kimi": "Run `kimi login` in Terminal once.",
  "cli-grok": "Run `grok` in Terminal and sign in once.",
};

export function Connections() {
  const { toast } = useStudio();
  const producer = useProducer();
  const [report, setReport] = useState<ConnectionsReport | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | "testing">>({});
  const [setupFor, setSetupFor] = useState<string | null>(null);
  const [mode, setMode] = useState(serverMode);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await detectServerMode();
    setMode(serverMode);
    const [prov, conn] = await Promise.all([
      api.providers().then((r) => r.providers).catch(() => [] as ProviderInfo[]),
      serverMode === "local" ? api.connections().catch(() => null) : Promise.resolve(null),
    ]);
    setProviders(prov);
    setReport(conn);
    void producer.refreshProviders();
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "testing" }));
    try {
      const r = id.startsWith("cli-") || id === "ollama" || id === "lmstudio" ? await api.connectionsTest(id) : await api.testProvider(id);
      setTests((t) => ({ ...t, [id]: { ok: r.ok, message: r.message } }));
      // a passing test puts the brain back into Auto's rotation; a failing one takes it out
      useProducer.setState((st) => {
        const failed = { ...st.failed };
        if (r.ok) delete failed[id]; else failed[id] = r.message;
        return { failed };
      });
      if (r.ok) toast(`${id} works`, "success");
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, message: String(e) } }));
    }
  };

  const connectOpenRouter = async () => {
    if (mode === "serverless") return void startOpenRouterBrowserOAuth();
    setBusy(true);
    try {
      const { url } = await api.oauthOpenRouterStart();
      await getHost().openExternalURL(url);
      toast("Finish signing in to OpenRouter in your browser. PulseForge picks it up automatically.");
      const t0 = Date.now();
      while (Date.now() - t0 < 180_000) {
        await new Promise((r) => setTimeout(r, 2500));
        const prov = (await api.providers()).providers;
        if (prov.find((p) => p.id === "openrouter")?.configured) { toast("OpenRouter connected", "success"); break; }
      }
    } catch (e) {
      toast(`OpenRouter sign-in failed: ${e}`, "error");
    }
    setBusy(false);
    void refresh();
  };

  const use = (id: string, name: string) => { producer.setChoice(id); toast(`The AI Producer now uses ${name}`, "success"); };
  const status = (id: string) => {
    const t = tests[id];
    if (t === "testing") return <span className="pill">testing…</span>;
    if (!t && producer.failed[id]) return <span className="pill warn" title={producer.failed[id]}>skipped by Auto: press Test after fixing</span>;
    if (!t) return null;
    return <span className={`pill ${t.ok ? "ok" : "err"}`} title={t.message}>{t.ok ? "working" : "failed"}</span>;
  };
  const textProviders = providers.filter((p) => p.kind === "text" && !p.id.startsWith("cli-") && p.id !== "ollama" && p.id !== "lmstudio");
  const audioProviders = providers.filter((p) => p.kind === "audio");

  return (
    <div className="page-fill">
      <div className="page-bar">
        <h1><Icon name="plug" /> Connections</h1>
        <span className="sub">{mode === "local" ? "Use the AI subscriptions and keys you already have." : "Hosted version: bring your own key (stored only in this browser)."}</span>
        <div className="spacer" />
        <span className="small dim">AI Producer uses: <b>{producer.resolvedProvider()?.name ?? "Offline producer"}</b></span>
        <button className="btn small" onClick={async () => { if (mode === "local") await api.connectionsRescan().catch(() => {}); await refresh(); }}><Icon name="loop" size={13} /> Rescan</button>
      </div>
      <div className="fill page">
        <div className="page-narrow col" style={{ gap: 14 }}>
          <Coach id="connections" title="No AI required:">
            the offline producer and the whole studio work without any connection. Connecting a subscription or key gets you smarter plans, revisions and producer reviews.
          </Coach>

          {mode === "local" ? (
            <div className="card">
              <h3><Icon name="terminal" /> Your AI subscriptions on this Mac</h3>
              <p className="small dim" style={{ marginTop: 0 }}>
                PulseForge runs your installed CLIs in answer-only mode: tools off, an empty sandbox folder, no file access. They use your existing logins, so your subscription covers it and there's nothing to paste.
                Login tokens are never read or copied out of these apps.
              </p>
              {!report && <p className="small dim">Scanning…</p>}
              {report?.clis.map((c) => (
                <div key={c.id} className="list-row">
                  <Icon name="terminal" />
                  <div className="grow">
                    <div className="title">{c.name} {c.installed ? <span className="pill ok">installed{c.version ? ` · ${c.version.split(" ")[0]}` : ""}</span> : <span className="pill">not found</span>} {!c.supported && c.installed && <span className="pill warn">detected, not supported yet</span>} {status(c.id)}</div>
                    <div className="meta">{c.installed ? c.path : `Install the ${c.binary} CLI to use your subscription`}{tests[c.id] && tests[c.id] !== "testing" && !(tests[c.id] as { ok: boolean }).ok ? ` — ${(tests[c.id] as { message: string }).message.slice(0, 140)} ${LOGIN_HINT[c.id] ?? ""}` : !tests[c.id] && producer.failed[c.id] ? ` — ${producer.failed[c.id]!.slice(0, 180)}` : ""}</div>
                  </div>
                  {c.installed && c.supported && <>
                    <button className="btn small" onClick={() => test(c.id)}>Test</button>
                    <button className="btn small primary" onClick={() => use(c.id, c.name)}>Use</button>
                  </>}
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <h3><Icon name="terminal" /> AI subscriptions (desktop app)</h3>
              <p className="small dim" style={{ margin: 0 }}>Using your Claude, Codex, Kimi or Grok subscriptions through their CLIs needs the PulseForge Mac app, which runs them on your machine. In this hosted version, use an API key or OpenRouter sign-in below.</p>
            </div>
          )}

          <div className="card">
            <h3><Icon name="key" /> One-click sign-in</h3>
            <div className="list-row">
              <Icon name="globe" />
              <div className="grow"><div className="title">OpenRouter {providers.find((p) => p.id === "openrouter")?.configured && <span className="pill ok">connected</span>}</div>
                <div className="meta">One login gives you hundreds of models (Claude, GPT, Gemini, Grok, Kimi, GLM, DeepSeek…) on one bill. Uses OAuth (PKCE), so you never copy a key.</div></div>
              <button className="btn small primary" disabled={busy} onClick={connectOpenRouter}>{busy ? "Waiting…" : "Connect with OpenRouter"}</button>
              {providers.find((p) => p.id === "openrouter")?.configured && <button className="btn small" onClick={() => use("openrouter", "OpenRouter")}>Use</button>}
            </div>
            <p className="small faint" style={{ marginBottom: 0 }}>Other providers (Anthropic, OpenAI, xAI, Moonshot/Kimi, Z.ai, Google) don't offer third-party sign-in for apps. Use their CLI subscription above or an API key below.</p>
          </div>

          {mode === "local" && report && (
            <div className="card">
              <h3><Icon name="headphones" /> Local models (free, private)</h3>
              {report.local.map((l) => (
                <div key={l.id} className="list-row">
                  <Icon name="bolt" />
                  <div className="grow"><div className="title">{l.id === "ollama" ? "Ollama" : "LM Studio"} {l.reachable ? <span className="pill ok">running · {l.models.length} models</span> : <span className="pill">not running</span>}</div>
                    <div className="meta">{l.reachable ? l.models.slice(0, 6).join(", ") || "no models pulled yet" : `Start ${l.id === "ollama" ? "Ollama" : "LM Studio's local server"} to use it. Nothing leaves your Mac.`}</div></div>
                  {l.reachable && <><button className="btn small" onClick={() => test(l.id)}>Test</button><button className="btn small primary" onClick={() => use(l.id, l.id === "ollama" ? "Ollama" : "LM Studio")}>Use</button></>} {status(l.id)}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h3><Icon name="key" /> API keys</h3>
            <p className="small dim" style={{ marginTop: 0 }}>{mode === "local" ? "Stored by the local backend (chmod 600) or read from your shell environment, never in the frontend or your project files." : "Stored only in this browser and sent to this site's stateless proxy per request. Never saved on the server."}</p>
            {report && report.envKeys.filter((e) => e.present).length > 0 && (
              <p className="small"><span className="pill ok">auto-detected</span> {report.envKeys.filter((e) => e.present).map((e) => e.envVar).join(", ")}{report.importedFromShell.length ? " (from your shell profile)" : ""}</p>
            )}
            {textProviders.map((p) => (
              <div key={p.id} className="list-row">
                <Icon name="chat" />
                <div className="grow"><div className="title">{p.name} {p.configured ? <span className="pill ok">ready</span> : <span className="pill">not set</span>} {status(p.id)}</div>
                  <div className="meta">{p.capabilities.slice(0, 5).join(" · ")}</div></div>
                <button className="btn small" onClick={() => setSetupFor(p.id)}>{p.configured ? "Edit" : "Add key"}</button>
                {p.configured && <><button className="btn small" onClick={() => test(p.id)}>Test</button><button className="btn small primary" onClick={() => use(p.id, p.name)}>Use</button></>}
              </div>
            ))}
            <ShowAt min="intermediate">
              <h3 className="section">Audio & voice providers</h3>
              {audioProviders.map((p) => (
                <div key={p.id} className="list-row">
                  <Icon name="wave" />
                  <div className="grow"><div className="title">{p.name} {p.configured ? <span className="pill ok">ready</span> : <span className="pill">not set</span>}</div>
                    <div className="meta">{p.capabilities.join(" · ")}</div></div>
                  <button className="btn small" onClick={() => setSetupFor(p.id)}>{p.configured ? "Edit" : "Set up"}</button>
                </div>
              ))}
            </ShowAt>
          </div>
        </div>
      </div>
      {setupFor && <ProviderSetup providers={providers.filter((p) => p.id === setupFor)} onClose={() => { setSetupFor(null); void refresh(); }} />}
    </div>
  );
}
