import { Component, type ReactNode } from "react";

interface SceneBoundaryState {
  failed: boolean;
}

export class SceneBoundary extends Component<{ children: ReactNode }, SceneBoundaryState> {
  state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full items-center justify-center px-6 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
          3D preview unavailable — the rest of the workspace is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
