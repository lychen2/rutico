import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { UNCATEGORIZED, type SidebarCategory } from "./SidebarCategories";

const FOLDER_DOT_CLASS_NAME = {
  attention: "bg-info",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-amber-600 dark:bg-amber-400",
};

const FOLDER_DOT_LABEL = {
  attention: msg(", needs you", { $context: "project folder status, read after its name" }),
  failed: msg(", failed", { $context: "project folder status, read after its name" }),
  unread: msg(", done", { $context: "project folder status, read after its name" }),
  working: msg(", working", { $context: "project folder status, read after its name" }),
};

export const sidebarCategoryRowId = (id: string) => `category:${id}`;

export function SidebarCategoryHeader({
  id,
  name,
  collapsed,
  hiddenThreads,
  onToggle,
}: {
  id: string;
  name: string;
  collapsed: boolean;
  hiddenThreads: readonly EnvironmentThreadShell[];
  onToggle: (id: string) => void;
}) {
  const m = useMessages();
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const dot = collapsed
    ? resolveSidebarFolderDot(
        hiddenThreads.map((thread) => ({
          ...thread,
          lastVisitedAt: resolveThreadLastVisitedAt(
            thread.lastVisitedAt,
            visits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
          ),
        })),
      )
    : null;
  return (
    <li className="mt-2 list-none first:mt-0">
      <button
        type="button"
        data-sidebar-row={sidebarCategoryRowId(id)}
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-start outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          {name}
        </span>
        {dot ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
            <span className="sr-only">{m(FOLDER_DOT_LABEL[dot])}</span>
          </span>
        ) : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {hiddenThreads.length}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground motion-safe:transition-transform motion-safe:duration-150",
            collapsed && "-rotate-90 rtl:rotate-90",
          )}
        />
      </button>
    </li>
  );
}

export type SidebarCategoryAction = { kind: "create" } | { kind: "move"; keys: readonly string[] };

export function SidebarCategoryDialog({
  action,
  categories,
  assignments,
  onClose,
  onCreate,
  onMove,
}: {
  action: SidebarCategoryAction | null;
  categories: readonly SidebarCategory[];
  assignments: Readonly<Record<string, string>>;
  onClose: () => void;
  onCreate: (name: string) => boolean;
  onMove: (keys: readonly string[], id: string) => boolean;
}) {
  const gt = useGT();
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const creating = action?.kind === "create";
  const normalizedName = name.trim();
  const close = () => {
    setName("");
    setFailed(false);
    onClose();
  };
  const save = (operation: () => boolean) => {
    if (operation()) close();
    else setFailed(true);
  };
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{creating ? gt("New category") : gt("Move to category")}</DialogTitle>
        </DialogHeader>
        {creating ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (normalizedName) save(() => onCreate(normalizedName));
            }}
          >
            <div className="px-6 pb-4">
              <Input
                aria-label={gt("Category name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{gt("Cancel")}</DialogClose>
              <Button type="submit" disabled={!normalizedName}>
                {gt("Create category")}
              </Button>
            </DialogFooter>
          </form>
        ) : action?.kind === "move" ? (
          <div className="flex max-h-[50vh] flex-wrap gap-2 overflow-y-auto px-6 pb-6">
            {[...categories, { id: UNCATEGORIZED, name: gt("Uncategorized") }].map(
              ({ id, name }) => {
                const selected = action.keys.every(
                  (key) => (assignments[key] ?? UNCATEGORIZED) === id,
                );
                return (
                  <Button
                    key={id}
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => save(() => onMove(action.keys, id))}
                  >
                    {name}
                  </Button>
                );
              },
            )}
          </div>
        ) : null}
        {failed ? (
          <p role="alert" className="px-6 pb-4 text-sm text-error">
            {gt("Could not save sidebar categories")}
          </p>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
