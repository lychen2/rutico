import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";

/** Base UI updates omit undefined; clear actions with defined actionProps and empty children, treated as
 * invisible. */
export function hasVisibleToastAction(actionProps: unknown): boolean {
  if (actionProps == null || typeof actionProps !== "object") {
    return false;
  }
  if (!("children" in actionProps)) {
    return false;
  }
  const children = actionProps.children;
  return children != null && children !== false && children !== "";
}

export function hasAnyToastAction(toast: {
  readonly actionProps?: unknown;
  readonly data?:
    | {
        readonly additionalActions?: readonly unknown[] | undefined;
        readonly secondaryActionProps?: unknown;
      }
    | undefined;
}): boolean {
  return (
    hasVisibleToastAction(toast.actionProps) ||
    (toast.data?.additionalActions?.length ?? 0) > 0 ||
    toast.data?.secondaryActionProps !== undefined
  );
}

/**
 * Tip 016 completion sheen fires exclusively for terminal non-actionable states
 * (`success` / `error`). Loading pulses and action-awaiting toasts stay calm.
 */
export function shouldPlayToastCompletionSheen(params: {
  readonly type?: string | undefined;
  readonly hasAction: boolean;
}): boolean {
  if (params.hasAction) return false;
  return params.type === "success" || params.type === "error";
}

export type ToastStackLayer = 0 | 1 | 2 | 3;

export function resolveToastStackLayer(visibleIndex: number): ToastStackLayer {
  if (visibleIndex <= 0) return 0;
  if (visibleIndex === 1) return 1;
  if (visibleIndex === 2) return 2;
  return 3;
}

export function shouldHideCollapsedToastContent(
  visibleToastIndex: number,
  visibleToastCount: number,
): boolean {
  if (visibleToastCount <= 1) return false;
  return visibleToastIndex > 0;
}

type ToastWithHeight = {
  height?: number | null | undefined;
};

type ToastWithTransitionStatus = {
  transitionStatus?: "starting" | "ending" | undefined;
};

type ToastWithLayoutProps = ToastWithHeight & ToastWithTransitionStatus;

type VisibleToastLayoutItem<TToast extends object> = {
  toast: TToast;
  visibleIndex: number;
  offsetY: number;
};

export function buildVisibleToastLayout<TToast extends object>(
  visibleToasts: readonly (TToast & ToastWithLayoutProps)[],
): {
  frontmostHeight: number;
  items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[];
} {
  let fullIndex = 0;
  let fullOffsetY = 0;
  let liveIndex = 0;
  let liveOffsetY = 0;

  const items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[] = visibleToasts.map(
    (toast) => {
      const height = normalizeToastHeight(toast.height);

      if (toast.transitionStatus === "ending") {
        const item = {
          toast,
          visibleIndex: fullIndex,
          offsetY: fullOffsetY,
        };
        fullOffsetY += height;
        fullIndex += 1;
        return item;
      }

      const item = {
        toast,
        visibleIndex: liveIndex,
        offsetY: liveOffsetY,
      };

      fullOffsetY += height;
      fullIndex += 1;
      liveOffsetY += height;
      liveIndex += 1;
      return item;
    },
  );

  const frontmostLiveToast = visibleToasts.find((toast) => toast.transitionStatus !== "ending");

  return {
    frontmostHeight: normalizeToastHeight(frontmostLiveToast?.height),
    items,
  };
}

function normalizeToastHeight(height: number | null | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

export function shouldRenderThreadScopedToast(
  data:
    | {
        threadRef?: ScopedThreadRef | null;
        threadId?: ThreadId | null;
      }
    | undefined,
  activeThreadRef: ScopedThreadRef | null,
): boolean {
  if (data?.threadRef) {
    return (
      activeThreadRef !== null &&
      data.threadRef.environmentId === activeThreadRef.environmentId &&
      data.threadRef.threadId === activeThreadRef.threadId
    );
  }

  const toastThreadId = data?.threadId;
  if (!toastThreadId) {
    return true;
  }

  return activeThreadRef?.threadId === toastThreadId;
}
