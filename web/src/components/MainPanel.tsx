import { useAppState } from "../state/store.js";
import { Terminal } from "./Terminal.js";

export function MainPanel() {
  const {
    selectedPane,
  } = useAppState();
  const hasSelectedPane = selectedPane !== null;

  return (
    <div className="main-panel">
      <header className="main-header">
        <h1 className="main-header-title" data-testid="main-title">
          {hasSelectedPane
            ? `${selectedPane.session} / ${selectedPane.window} / ${selectedPane.pane}`
            : "Wmux"}
        </h1>
      </header>

      <main className="main-content">
        {hasSelectedPane ? (
          <Terminal selectedPane={selectedPane} />
        ) : (
          <div className="empty-state" data-testid="empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M6 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M6 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="empty-state-title">Select a session</p>
            <p className="empty-state-description">
              Expand a session in the sidebar and click a pane to open the terminal
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
