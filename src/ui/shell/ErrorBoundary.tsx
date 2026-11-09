/**
 * Page-level error boundary: a crash inside one page (or a lazy page that failed to download)
 * shows a recovery card instead of blanking the whole studio. The project, transport and other
 * pages keep working; "Try again" remounts the page, "Go Home" leaves it.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "./Icons";

interface Props { children: ReactNode; label: string; onHome?: () => void }
interface State { error: Error | null; attempt: number }

export class PageBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[pulseforge] the ${this.props.label} page crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error, attempt } = this.state;
    if (!error) return <div key={attempt} style={{ display: "contents" }}>{this.props.children}</div>;
    const chunk = /dynamically imported module|Loading chunk|Failed to fetch/i.test(error.message);
    return (
      <div className="page-crash" role="alert">
        <div className="page-crash-card">
          <span className="page-crash-ico"><Icon name="alert" size={22} /></span>
          <h2>{chunk ? `${this.props.label} couldn't load` : `${this.props.label} hit a problem`}</h2>
          <p className="dim">
            {chunk
              ? "Part of the app didn't download. Check your connection and try again."
              : "Your project is safe: it autosaves, and everything else keeps working. Try the page again, or head Home."}
          </p>
          <pre className="page-crash-msg">{error.message}</pre>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => this.setState({ error: null, attempt: attempt + 1 })}><Icon name="undo" size={14} /> Try again</button>
            {this.props.onHome && <button className="btn" onClick={() => { this.setState({ error: null, attempt: attempt + 1 }); this.props.onHome!(); }}><Icon name="home" size={14} /> Go Home</button>}
          </div>
        </div>
      </div>
    );
  }
}

/** shown while a lazily loaded page downloads (usually a few frames) */
export function PageLoading({ label }: { label: string }) {
  return (
    <div className="page-loading" aria-busy="true" aria-label={`Loading ${label}`}>
      <span className="page-loading-dot" /><span className="page-loading-dot" /><span className="page-loading-dot" />
    </div>
  );
}
