import { useEffect, useRef } from "react";

export type DecisionAction = {
  id: string;
  label: string;
  tone?: "primary" | "danger";
};

export type DecisionSpec = {
  title: string;
  message: string;
  actions: DecisionAction[];
};

type Props = {
  spec: DecisionSpec;
  onChoose: (id: string) => void;
};

export function DecisionDialog({ spec, onChoose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const preferred = dialogRef.current?.querySelector<HTMLButtonElement>("button.is-primary");
    (preferred ?? dialogRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);

  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(event) => {
        keepFocusInDialog(event);
        if (event.key === "Escape") {
          const cancel = spec.actions.find((action) => action.id === "cancel");
          if (cancel) onChoose(cancel.id);
        }
      }}
    >
      <div
        ref={dialogRef}
        className="decision-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <h2 id="dialog-title">{spec.title}</h2>
        <p id="dialog-message">{spec.message}</p>
        <div className="dialog-actions">
          {spec.actions.map((action) => (
            <button
              type="button"
              key={action.id}
              className={action.tone ? `is-${action.tone}` : undefined}
              onClick={() => onChoose(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
