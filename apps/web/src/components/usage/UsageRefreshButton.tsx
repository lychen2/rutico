import { uiText } from "../../i18n";
import { useEffect, useState, type ComponentProps } from "react";
import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";

export function UsageRefreshButton({
  busy,
  disabled,
  onClick,
  label,
  iconOnly = false,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "onClick" | "disabled"> & {
  readonly iconOnly?: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  const [state, setState] = useState({ busy, updated: false });
  if (state.busy !== busy) setState({ busy, updated: state.busy && !busy });
  const updated = state.updated && !busy;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expires the transient completion label after the external read settles
  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setState((current) => ({ ...current, updated: false })), 1600);
    return () => clearTimeout(timer);
  }, [updated]);
  return (
    <button
      {...props}
      type="button"
      className={cn("usage-refresh-button", className)}
      data-icon-only={iconOnly || undefined}
      data-state={busy ? "busy" : updated ? "updated" : "idle"}
      aria-label={label}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
    >
      {updated ? (
        <CheckIcon size={16} className="t3-icon-pop text-success" />
      ) : (
        <RefreshCwIcon
          size={16}
          ref={busy ? observeVisibleAnimation : undefined}
          data-usage-refresh={busy || undefined}
        />
      )}
      <span className={iconOnly ? "sr-only" : undefined}>
        {busy ? uiText("Reading") : updated ? uiText("Updated") : label}
      </span>
    </button>
  );
}
