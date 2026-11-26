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
import type { SidebarCategory } from "./SidebarCategories";
import { BUILT_IN_CATEGORY_IDS, SIDEBAR_PRESET_RULES, UNCATEGORIZED } from "./SidebarCategoryRules";
import type { SidebarCategoryPreset } from "./SidebarCategoryRules";

export type SidebarCategoryOption = SidebarCategory & { readonly builtIn?: true };

const BUILT_IN_CATEGORY_LABELS = {
  wechat: msg("WeChat Official Accounts"),
  "douyin-real": msg("Douyin · Main account"),
  "douyin-ai": msg("Douyin · Yigen AI"),
  "douyin-other": msg("Douyin · Other"),
  xiaohongshu: msg("Xiaohongshu"),
  x: msg("X", { $context: "social media platform, formerly Twitter" }),
  xiaodao: msg("Xiaodao Economics"),
  video: msg("Video · Animation · Music"),
  "content-other": msg("Other content"),
  company: msg("Company operations"),
  client: msg("Client delivery"),
  product: msg("Products and websites"),
  invest: msg("Investment research"),
  optics: msg("Optics and photonics"),
  "numerical-simulation": msg("Numerical simulation"),
  "software-development": msg("Software development"),
  t3: msg("T3 features and maintenance"),
  models: msg("Models and accounts"),
  automation: msg("Automation and knowledge bases"),
  devices: msg("Computers and devices"),
  "tools-other": msg("Other tools"),
};

const PRESET_CATEGORY_LABELS = {
  development: msg("Development"),
  content: msg("Writing & content"),
  research: msg("Research"),
  work: msg("Work admin"),
  systems: msg("Tools & system"),
  fixes: msg("Bug fixes"),
  features: msg("Features"),
  review: msg("Code review"),
  docs: msg("Docs"),
  deploy: msg("Deploy & ops"),
  scripts: msg("Ideas & scripts"),
  writing: msg("Writing"),
  media: msg("Video & audio"),
  publishing: msg("Publishing"),
};

export function useSidebarCategoryOptions(
  custom: readonly SidebarCategory[],
  preset: SidebarCategoryPreset,
  assignments: Readonly<Record<string, string>>,
) {
  const m = useMessages();
  if (preset === "project") return [];
  const ids = new Set<string>(
    preset === "legacy" ? BUILT_IN_CATEGORY_IDS : SIDEBAR_PRESET_RULES[preset].map(([id]) => id),
  );
  const assigned = new Set(Object.values(assignments));
  for (const id of [...Object.keys(PRESET_CATEGORY_LABELS), ...BUILT_IN_CATEGORY_IDS]) {
    if (assigned.has(id)) ids.add(id);
  }
  const labels = new Map([
    ...Object.entries(PRESET_CATEGORY_LABELS),
    ...Object.entries(BUILT_IN_CATEGORY_LABELS),
  ]);
  return [
    ...custom,
    ...Array.from(ids, (id): SidebarCategoryOption => ({
      id,
      name: m(labels.get(id)!),
      builtIn: true,
    })),
  ];
}

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
        className="group/category flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-start outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <FolderIcon
          aria-hidden
          className="size-4 shrink-0 text-sidebar-muted-foreground transition-colors duration-150 group-hover/category:text-sidebar-foreground/80 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          {name}
        </span>
        {dot ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
            <span className="sr-only">{m(FOLDER_DOT_LABEL[dot])}</span>
          </span>
        ) : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="shrink-0 rounded-full bg-sidebar-control-surface/70 px-1.5 py-0.5 text-2xs leading-none font-medium tabular-nums text-sidebar-muted-foreground ring-1 ring-inset ring-sidebar-border/40 dark:ring-white/6">
            {hiddenThreads.length}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-(--ease-drawer)",
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
  categoryByThreadKey,
  assignments,
  onClose,
  onCreate,
  onMove,
}: {
  action: SidebarCategoryAction | null;
  categories: readonly SidebarCategory[];
  categoryByThreadKey: ReadonlyMap<string, string>;
  assignments: Readonly<Record<string, string>>;
  onClose: () => void;
  onCreate: (name: string) => boolean;
  onMove: (keys: readonly string[], id: string | null) => boolean;
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
                  (key) => (categoryByThreadKey.get(key) ?? UNCATEGORIZED) === id,
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
            {action.keys.some((key) => assignments[key] !== undefined) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => save(() => onMove(action.keys, null))}
              >
                {gt("Restore automatic categorization")}
              </Button>
            ) : null}
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
