import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error?: Error;
};

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown editor failed to render", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="editor-failure" role="alert">
        <strong>文档编辑器载入失败</strong>
        <span>{this.state.error.message || "未知错误"}</span>
        <button type="button" onClick={() => this.setState({ error: undefined })}>重新载入</button>
      </div>
    );
  }
}
