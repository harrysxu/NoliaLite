import { AlertCircle, AlertTriangle, FileWarning, Info, Lock } from "lucide-react";

type Action = { label: string; onClick: () => void; danger?: boolean };

type Props = {
  tone: "info" | "warning" | "danger";
  message: string;
  actions?: Action[];
  alert?: boolean;
};

export function StatusBanner({ tone, message, actions = [], alert }: Props) {
  const Icon = tone === "danger" ? AlertCircle : tone === "warning" ? AlertTriangle : Info;
  const StatusIcon = message.includes("只读") ? Lock : message.includes("移动或删除") ? FileWarning : Icon;
  return (
    <div className={`status-banner is-${tone}`} role={alert ? "alert" : "status"}>
      <StatusIcon size={16} aria-hidden="true" />
      <span>{message}</span>
      {actions.length ? (
        <div className="status-actions">
          {actions.map((action) => (
            <button
              type="button"
              key={action.label}
              className={action.danger ? "is-danger" : undefined}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
