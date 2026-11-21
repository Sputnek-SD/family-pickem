import { Component, type ReactNode } from "react";

type State = { failed: boolean };

/** Last resort so a render error shows a reload screen instead of a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app solo">
        <section className="welcome app-error" data-testid="app-error">
          <h1>Something went wrong, tap to reload</h1>
          <button type="button" className="primary" onClick={() => location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
