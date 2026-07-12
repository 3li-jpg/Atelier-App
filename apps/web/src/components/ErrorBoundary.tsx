import { Component, type ErrorInfo, type ReactNode } from "react";

// Global error boundary — catches render errors anywhere in the component
// tree that main.tsx wraps (App + CommandPalette). Shows a recoverable
// error screen with a "Reload" button instead of a white screen.
// Does NOT catch errors in event handlers, async code, or setTimeout —
// those are handled by the individual view error states.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <span className="error-boundary-icon" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M24 14v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="24" cy="32" r="2" fill="currentColor" />
            </svg>
          </span>
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-desc muted">
            An unexpected error occurred. Reloading usually fixes it — your
            sessions are safe on the server.
          </p>
          {this.state.error && (
            <details className="error-boundary-details">
              <summary className="muted small">Error details</summary>
              <pre className="error-boundary-trace">
                {this.state.error.message}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
              </pre>
            </details>
          )}
          <button
            className="primary"
            onClick={() => window.location.reload()}
            aria-label="Reload the application"
          >
            Reload app
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
