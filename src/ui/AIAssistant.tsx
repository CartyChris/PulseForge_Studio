/** AI Production Assistant: provider setup, compose (structured songs), edit plans
 * (preview → accept/reject), analysis, lyrics, mix suggestions, Reversible Autopilot. */
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { api, type ProviderInfo } from "../api";
import { projectSummary, songStructure, insertComposition, type InsertOptions } from "../state/composition";
import type { Composition } from "../../shared/composition";
import type { EditPlan } from "../../shared/commands";
import { applyPulseTune } from "./PulseTune";

type Mode = "ask" | "compose" | "edit" | "lyrics" | "mix";

interface ChatMsg {
  role: "user" | "ai" | "system";
  text: string;
  composition?: Composition;
  plan?: EditPlan;
  planApplied?: boolean;
}

export function AIAssistant() {
  const { project, update, dispatchMany, undo, toast, setFlags } = useStudio();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(localStorage.getItem("pf_provider") ?? "");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Mode>("compose");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  // other panels can hand off a prefilled prompt (e.g. Channel Rack "AI Continue")
  useEffect(() => {
    const h = (e: Event) => setInput((e as CustomEvent<string>).detail);
    window.addEventListener("pf-ai-prefill", h);
    return () => window.removeEventListener("pf-ai-prefill", h);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = () => api.providers().then((r) => setProviders(r.providers)).catch(() => setProviders([]));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999 }); }, [msgs, busy]);

  const provider = providers.find((p) => p.id === providerId);
  const textProviders = providers.filter((p) => p.kind === "text");

  const push = (m: ChatMsg) => setMsgs((x) => [...x, m]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (!provider) return toast("Choose and configure an AI provider first (⚙ Setup)", "error");
    setInput("");
    push({ role: "user", text: prompt });
    setBusy(true);
    setFlags({ cloudActive: provider.id !== "ollama", aiBusy: true });
    try {
      const summary = projectSummary(project);
      if (mode === "compose") {
        const { composition } = await api.compose(provider.id, prompt, summary, model || undefined);
        push({
          role: "ai",
          text: `“${composition.title}” — ${composition.genre || "untitled genre"}, ${composition.bpm} BPM, ${composition.key} ${composition.scale}\nSections: ${composition.sections.map((s) => `${s.name} (${s.lengthBars} bars)`).join(", ")}${composition.productionNotes ? `\n\n${composition.productionNotes}` : ""}`,
          composition,
        });
      } else if (mode === "edit") {
        const { plan } = await api.editPlan(provider.id, prompt, summary, model || undefined);
        if (autopilot) {
          const ok = await applyPlanWithAudio(plan.commands);
          push({ role: "ai", text: `${plan.title}\n${plan.explanation}\n\n⚡ Autopilot applied ${plan.commands.length} commands (undo with ⌘Z).`, plan, planApplied: ok });
        } else {
          push({ role: "ai", text: `${plan.title}\n${plan.explanation}`, plan });
        }
      } else if (mode === "lyrics") {
        const { text } = await api.lyrics(provider.id, prompt, `Song context: ${project.bpm} BPM, key ${project.key} ${project.scale}. Structure:\n${songStructure(project)}`, model || undefined);
        push({ role: "ai", text });
      } else if (mode === "mix") {
        const { text } = await api.suggestMix(provider.id, prompt, summary, model || undefined);
        push({ role: "ai", text: `${text}\n\n(These are starting points, not objective truths — trust your ears. Use Edit mode to have me apply any of this as an undoable plan.)` });
      } else {
        const { text } = await api.analyzeProject(provider.id, prompt, summary, model || undefined);
        push({ role: "ai", text });
      }
    } catch (e) {
      push({ role: "system", text: `⚠ ${String(e).slice(0, 400)}` });
    }
    setBusy(false);
    setFlags({ cloudActive: false, aiBusy: false });
  };

  /** Apply a plan's commands: pulseTune commands run async audio DSP first (each
   * produces a new asset), then everything (with resolved asset refs) dispatches. */
  const applyPlanWithAudio = async (commands: EditPlan["commands"]): Promise<boolean> => {
    const tunes = commands.filter((c) => c.type === "pulseTune");
    const rest = commands.filter((c) => c.type !== "pulseTune");
    for (const t of tunes) {
      if (t.type !== "pulseTune") continue;
      await applyPulseTune(t.assetId, { rootPc: t.rootPc, scaleName: t.scaleName, strength: t.strength, retuneMs: t.retuneMs, humanize: t.humanize });
    }
    if (tunes.length) toast(`PulseTune created ${tunes.length} tuned asset(s) — originals untouched`, "success");
    return rest.length ? dispatchMany(rest) : true;
  };

  const applyPlan = async (i: number) => {
    const m = msgs[i];
    if (!m?.plan) return;
    try {
      const ok = await applyPlanWithAudio(m.plan.commands);
      if (ok) {
        setMsgs((x) => x.map((mm, j) => (j === i ? { ...mm, planApplied: true } : mm)));
        toast(`Applied "${m.plan.title}" — undo with ⌘Z`, "success");
      }
    } catch (e) {
      toast(`Plan failed: ${e}`, "error");
    }
  };

  const insertComp = (i: number, opts: InsertOptions) => {
    const m = msgs[i];
    if (!m?.composition) return;
    try {
      update((p) => insertComposition(p, m.composition!, opts));
      toast(`Inserted ${opts.mode === "full" ? "full composition" : opts.mode} — undo with ⌘Z`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <div className="ai-pane">
      <div className="pr-toolbar">
        <select className="sel" value={providerId} onChange={(e) => { setProviderId(e.target.value); localStorage.setItem("pf_provider", e.target.value); }} aria-label="AI provider">
          <option value="">— choose provider —</option>
          {textProviders.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? " ✓" : ""}</option>)}
        </select>
        <input className="num-input" style={{ width: 150, textAlign: "left" }} placeholder="model (default)" value={model} onChange={(e) => setModel(e.target.value)} title="Override the provider's default model" />
        <button className="btn small" onClick={() => setSetupOpen(true)}>⚙ Setup</button>
        <div className="spacer" />
        <label className="row small dim" title="Autopilot applies edit plans immediately — still fully undoable, never deletes source audio, never spends money without the normal generation flow">
          <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} />
          Reversible Autopilot
        </label>
        <button className="btn small" onClick={undo} title="Undo last change (incl. AI edits)">Undo last</button>
      </div>

      <div className="ai-scroll" ref={scrollRef}>
        {!msgs.length && (
          <div className="dim" style={{ maxWidth: 560 }}>
            <p><strong>AI Production Assistant.</strong> Everything here flows through validated, reversible commands — the AI can never run code or touch files, and every change lands in undo history.</p>
            <p>Modes:</p>
            <ul className="small">
              <li><strong>Compose</strong> — “write a moody 90 BPM hip-hop verse and chorus” → structured song rendered with built-in instruments</li>
              <li><strong>Edit</strong> — “make the drums quieter and add reverb to the vocals” → command plan you approve</li>
              <li><strong>Ask</strong> — project analysis & arrangement advice</li>
              <li><strong>Lyrics</strong> / <strong>Mix</strong> — words & mix suggestions</li>
            </ul>
            <p className="small faint">No provider connected yet? Open ⚙ Setup. Local models via Ollama work too — no API key, nothing leaves your Mac.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "user" : ""}`}>
            <div className="bubble" style={m.role === "system" ? { borderColor: "var(--red)" } : undefined}>{m.text}</div>
            {m.composition && (
              <div className="plan-card">
                <strong className="small">Insert composition:</strong>
                <div className="row" style={{ flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  <button className="btn small primary" onClick={() => insertComp(i, { mode: "full" })}>Full song</button>
                  <button className="btn small" onClick={() => insertComp(i, { mode: "alternate", applyTempo: false })}>As alternate (append)</button>
                  <button className="btn small" onClick={() => insertComp(i, { mode: "drums-only" })}>Drums only</button>
                  <button className="btn small" onClick={() => insertComp(i, { mode: "notes-only" })}>Notes only</button>
                  {m.composition.sections.map((s) => (
                    <button key={s.name} className="btn small" onClick={() => insertComp(i, { mode: "sections", sectionNames: [s.name], applyTempo: false })}>+ {s.name}</button>
                  ))}
                  {project.patterns.length > 0 && (
                    <select className="sel" value="" onChange={(e) => {
                      if (e.target.value) insertComp(i, { mode: "replace-pattern", replacePatternId: e.target.value, sectionNames: [m.composition!.sections[0]!.name] });
                      e.target.value = "";
                    }}>
                      <option value="">replace pattern…</option>
                      {project.patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                {m.composition.sections.some((s) => s.lyrics) && (
                  <details style={{ marginTop: 6 }}>
                    <summary className="small dim">Lyrics</summary>
                    <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{m.composition.sections.map((s) => `[${s.name}]\n${s.lyrics}${s.adLibs.length ? `\n(ad-libs: ${s.adLibs.join(", ")})` : ""}`).join("\n\n")}</pre>
                  </details>
                )}
              </div>
            )}
            {m.plan && (
              <div className="plan-card">
                <strong className="small">{m.plan.commands.length} commands{m.planApplied ? " — applied ✓" : ""}</strong>
                {m.plan.commands.slice(0, 20).map((c, j) => (
                  <div key={j} className="cmd">{JSON.stringify(c).slice(0, 110)}</div>
                ))}
                {m.plan.commands.length > 20 && <div className="cmd">… {m.plan.commands.length - 20} more</div>}
                {!m.planApplied && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn small primary" onClick={() => applyPlan(i)}>Accept & apply</button>
                    <button className="btn small" onClick={() => setMsgs((x) => x.map((mm, j) => (j === i ? { ...mm, plan: undefined } : mm)))}>Reject</button>
                    <span className="faint small">applies atomically; ⌘Z reverts</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="dim small">thinking…</div>}
      </div>

      <div className="ai-composer-bar">
        <select className="sel" value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Assistant mode">
          <option value="compose">Compose</option>
          <option value="edit">Edit</option>
          <option value="ask">Ask</option>
          <option value="lyrics">Lyrics</option>
          <option value="mix">Mix</option>
        </select>
        <textarea
          placeholder={mode === "compose" ? "Describe the song or section to compose…" : mode === "edit" ? "Describe the change to make…" : "Ask about your project…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={send}>Send</button>
      </div>

      {setupOpen && <ProviderSetup providers={providers} onClose={() => { setSetupOpen(false); refresh(); }} />}
    </div>
  );
}

export function ProviderSetup({ providers, onClose }: { providers: ProviderInfo[]; onClose: () => void }) {
  const { toast } = useStudio();
  const [sel, setSel] = useState(providers[0]?.id ?? "");
  const [key, setKey] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState("");
  const p = providers.find((x) => x.id === sel);

  useEffect(() => { setConfig(p?.config ?? {}); setTestResult(""); setKey(""); }, [sel, p]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ minWidth: 520 }}>
        <h2>AI Providers</h2>
        <p className="dim small">Keys are stored by the local backend (~/.pulseforge, chmod 600) or via environment variables — they never enter the frontend or your project files.</p>
        <div className="field"><label>Provider</label>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {providers.map((x) => <option key={x.id} value={x.id}>{x.name} {x.configured ? "✓" : ""}</option>)}
          </select></div>
        {p && (
          <>
            <p className="small dim">Capabilities: {p.capabilities.length ? p.capabilities.join(", ") : "manual import workflow only"}</p>
            {p.needsKey && (
              <div className="field"><label>API key {p.hasKey ? "(already set — enter to replace, blank to clear)" : ""}</label>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" /></div>
            )}
            {p.configFields.map((f) => (
              <div className="field" key={f}><label>{f}</label>
                <input value={config[f] ?? ""} onChange={(e) => setConfig({ ...config, [f]: e.target.value })}
                  placeholder={f === "baseUrl" ? "https://…" : ""} /></div>
            ))}
            <div className="row">
              <button className="btn primary" onClick={async () => {
                try {
                  if (p.needsKey && (key || p.hasKey)) { if (key) await api.setSecret(p.id, key); }
                  if (p.configFields.length) await api.setConfig(p.id, config);
                  toast("Provider saved", "success");
                } catch (e) { toast(String(e), "error"); }
              }}>Save</button>
              <button className="btn" onClick={async () => {
                setTestResult("testing…");
                try {
                  const r = await api.testProvider(p.id);
                  setTestResult(`${r.ok ? "✓" : "✗"} ${r.message}${r.models?.length ? ` · models: ${r.models.slice(0, 6).join(", ")}…` : ""}`);
                } catch (e) { setTestResult(`✗ ${e}`); }
              }}>Test connection</button>
            </div>
            {testResult && <p className="small mono" style={{ marginTop: 8 }}>{testResult}</p>}
          </>
        )}
        <div className="row end"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
