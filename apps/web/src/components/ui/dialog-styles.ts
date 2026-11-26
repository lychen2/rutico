import { useEffect } from "react";

let activeSpatialModalCount = 0;

function syncSpatialModalDepthAttribute(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (activeSpatialModalCount <= 0) {
    delete root.dataset.spatialModalDepth;
    return;
  }
  root.dataset.spatialModalDepth = activeSpatialModalCount >= 2 ? "2" : "1";
}

function acquireSpatialModalDepth(): () => void {
  activeSpatialModalCount += 1;
  syncSpatialModalDepthAttribute();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSpatialModalCount = Math.max(0, activeSpatialModalCount - 1);
    syncSpatialModalDepthAttribute();
  };
}

/** Tracks stacked open modals on `html[data-spatial-modal-depth]` and clears it on close. */
function useSpatialModalDepth(active: boolean): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs open modal count onto documentElement dataset for workbench depth recess
  useEffect(() => {
    if (!active) return;
    return acquireSpatialModalDepth();
  }, [active]);
}

const DIALOG_BACKDROP_BASE_CLASS =
  "fixed inset-0 z-50 transition-opacity duration-220 ease-out data-ending-style:duration-150 data-ending-style:ease-(--ease-exit) data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none";

const DIALOG_BACKDROP_CLASS = `dialog-backdrop ${DIALOG_BACKDROP_BASE_CLASS}`;
const DIALOG_MEDIA_BACKDROP_CLASS = `${DIALOG_BACKDROP_BASE_CLASS} bg-black/75 backdrop-blur-none`;

const DIALOG_POPUP_BASE_CLASS =
  "-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-280 ease-(--spring-spatial) data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:duration-150 data-ending-style:ease-(--ease-exit) data-ending-style:translate-y-1.5 data-starting-style:translate-y-2.5 data-ending-style:scale-[0.97] data-starting-style:scale-[0.96] data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 motion-reduce:transition-none [-webkit-app-region:no-drag]";

const DIALOG_POPUP_CLASS = `dialog-glass surface-elevated-rim ${DIALOG_POPUP_BASE_CLASS} rounded-(--radius-concentric-dialog)`;
const DIALOG_MEDIA_POPUP_CLASS = `${DIALOG_POPUP_BASE_CLASS} max-h-[92vh] w-auto max-w-[92vw] overflow-visible rounded-none border border-transparent bg-transparent p-0 shadow-none`;

const DIALOG_MOBILE_SHEET_CLASS =
  "max-sm:max-w-none max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4";

export {
  DIALOG_BACKDROP_CLASS,
  DIALOG_MEDIA_BACKDROP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  DIALOG_MEDIA_POPUP_CLASS,
  useSpatialModalDepth,
};
