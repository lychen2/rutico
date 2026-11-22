import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import {
  sidebarSuggestionModels,
  SIDEBAR_SUGGESTION_MAX_CATEGORIES,
  SIDEBAR_SUGGESTION_MAX_CATEGORY_LENGTH,
  SIDEBAR_SUGGESTION_MAX_TITLES,
  SIDEBAR_SUGGESTION_MAX_TITLE_LENGTH,
  WS_METHODS,
} from "@t3tools/contracts";
import type { EnvironmentId, ModelSelection, ServerProvider } from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react";
import { FolderSearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentPresentations } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import type { SidebarCategory } from "./SidebarCategories";
import { isClassifiableSidebarTitle } from "./SidebarCategoryRules";

const suggest = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "sidebar:category-suggestions",
  tag: WS_METHODS.serverSuggestSidebarCategories,
});

interface Candidate {
  readonly key: string;
  readonly title: string;
}

interface ReviewRow extends Candidate {
  readonly id: string;
  readonly reason: string;
  readonly checked: boolean;
}

export function SidebarCategorySuggestions({
  threads,
  categories,
  connected,
  primary,
  labels,
  models,
  onSelectModel,
  onConfirm,
}: {
  threads: readonly EnvironmentThreadShell[];
  categories: readonly SidebarCategory[];
  connected: readonly EnvironmentId[];
  primary: EnvironmentId | null;
  labels: ReadonlyMap<string, string>;
  models: Readonly<Record<string, ModelSelection>> | undefined;
  onSelectModel: (environmentId: EnvironmentId, selection: ModelSelection | null) => void;
  onConfirm: (moves: readonly { key: string; id: string }[]) => boolean;
}) {
  const gt = useGT();
  const providers = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const [open, setOpen] = useState(false);
  const candidates = new Map<EnvironmentId, Candidate[]>();
  const connectedIds = new Set(connected);
  for (const thread of threads) {
    if (!connectedIds.has(thread.environmentId) || !isClassifiableSidebarTitle(thread.title))
      continue;
    const candidate = {
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      title: thread.title,
    };
    const list = candidates.get(thread.environmentId);
    if (list === undefined) candidates.set(thread.environmentId, [candidate]);
    else list.push(candidate);
  }
  const environments = Array.from(candidates.keys()).filter(
    (id) => sidebarSuggestionModels(providers.get(id) ?? []).length > 0,
  );
  const first = primary !== null && environments.includes(primary) ? primary : environments[0];
  if (first === undefined || categories.length === 0) return null;
  return (
    <>
      <SidebarHeaderIconButton label={gt("Suggest categories")} onClick={() => setOpen(true)}>
        <FolderSearchIcon aria-hidden />
      </SidebarHeaderIconButton>
      {open ? (
        <CategorySuggestionDialog
          initialEnvironment={first}
          environments={environments}
          labels={labels}
          candidates={candidates}
          providers={providers}
          categories={categories}
          models={models}
          onSelectModel={onSelectModel}
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function CategorySuggestionDialog({
  initialEnvironment,
  environments,
  labels,
  candidates,
  providers,
  categories,
  models,
  onSelectModel,
  onConfirm,
  onClose,
}: {
  initialEnvironment: EnvironmentId;
  environments: readonly EnvironmentId[];
  labels: ReadonlyMap<string, string>;
  candidates: ReadonlyMap<EnvironmentId, readonly Candidate[]>;
  providers: ReadonlyMap<EnvironmentId, readonly ServerProvider[]>;
  categories: readonly SidebarCategory[];
  models: Readonly<Record<string, ModelSelection>> | undefined;
  onSelectModel: (environmentId: EnvironmentId, selection: ModelSelection | null) => void;
  onConfirm: (moves: readonly { key: string; id: string }[]) => boolean;
  onClose: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const run = useAtomCommand(suggest, { reportFailure: false });
  const [environment, setEnvironment] = useState(initialEnvironment);
  const permitted = useAtomValue(suggest.permissionAtom(environment));
  const [review, setReview] = useState<{ model: string; rows: readonly ReviewRow[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abort the environment RPC when the review dialog unmounts
  useEffect(() => () => controller.current?.abort(), []);

  const choices = sidebarSuggestionModels(providers.get(environment) ?? []);
  const saved = models?.[environment];
  const selectedIndex = choices.findIndex(
    ({ selection }) =>
      selection.instanceId === saved?.instanceId && selection.model === saved.model,
  );
  const batch = candidates.get(environment)?.slice(0, SIDEBAR_SUGGESTION_MAX_TITLES) ?? [];
  const requestCategories = categories.slice(0, SIDEBAR_SUGGESTION_MAX_CATEGORIES);
  const eligible = new Map(candidates.get(environment)?.map(({ key, title }) => [key, title]));
  const activeCategoryIds = new Set(categories.map(({ id }) => id));
  const checked =
    review?.rows.filter(
      (row) => row.checked && eligible.get(row.key) === row.title && activeCategoryIds.has(row.id),
    ) ?? [];
  const request = async () => {
    if (!permitted || batch.length === 0 || choices.length === 0 || controller.current !== null)
      return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setReview(null);
    setError(null);
    const result = await run(
      {
        environmentId: environment,
        input: {
          titles: batch.map(({ title }) => title.slice(0, SIDEBAR_SUGGESTION_MAX_TITLE_LENGTH)),
          categories: requestCategories.map(({ name }) =>
            name.slice(0, SIDEBAR_SUGGESTION_MAX_CATEGORY_LENGTH),
          ),
          modelSelection: choices[selectedIndex]?.selection ?? null,
          language: locale.startsWith("zh") ? "zh" : "en",
        },
      },
      { signal: active.signal },
    );
    if (active.signal.aborted) return;
    controller.current = null;
    setPending(false);
    if (result._tag !== "Success") {
      setError(gt("Could not get suggestions. Choose an available model and try again."));
      return;
    }
    setReview({
      model: result.value.model,
      rows: result.value.suggestions.flatMap((row) => {
        const candidate = batch[row.titleIndex];
        const category = requestCategories[row.categoryIndex];
        return candidate && category
          ? [{ ...candidate, id: category.id, reason: row.reason, checked: true }]
          : [];
      }),
    });
  };
  const updateRow = (key: string, update: Partial<Pick<ReviewRow, "id" | "checked">>) => {
    setReview(
      (current) =>
        current && {
          ...current,
          rows: current.rows.map((row) => (row.key === key ? { ...row, ...update } : row)),
        },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPopup className="w-full max-w-[560px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{gt("Suggested categories")}</DialogTitle>
          <DialogDescription>
            {gt(
              "Only thread titles and category names are sent to the model. Checked threads move when you confirm.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-4 text-sm">
          {!review ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1">
                {gt("Environment")}
                <select
                  className="min-w-0 rounded-md border bg-background p-2"
                  value={environment}
                  disabled={pending}
                  onChange={(event) => {
                    const id = environments.find((candidate) => candidate === event.target.value);
                    if (id !== undefined) {
                      setEnvironment(id);
                      setError(null);
                    }
                  }}
                >
                  {environments.map((id) => (
                    <option key={id} value={id}>
                      {labels.get(id) ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1">
                {gt("Suggestion model")}
                <select
                  className="min-w-0 rounded-md border bg-background p-2"
                  value={selectedIndex}
                  disabled={pending}
                  onChange={(event) => {
                    onSelectModel(
                      environment,
                      choices[Number(event.target.value)]?.selection ?? null,
                    );
                    setError(null);
                  }}
                >
                  <option value={-1}>{gt("Automatic (lowest known price)")}</option>
                  {choices.map(({ selection, label }, index) => (
                    <option
                      key={JSON.stringify([selection.instanceId, selection.model])}
                      value={index}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {pending ? (
            <p role="status">{gt("Waiting for the model to classify these titles…")}</p>
          ) : null}
          {!permitted ? (
            <p role="status">{gt("This environment does not allow model suggestions.")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-error">
              {error}
            </p>
          ) : null}
          {review?.rows.length === 0 ? (
            <p role="status">{gt("No matching categories were suggested.")}</p>
          ) : null}
          {review && review.rows.length > 0 ? (
            <div className="max-h-[50vh] divide-y overflow-y-auto rounded-xl border">
              {review.rows.map((row) => {
                const current = eligible.get(row.key) === row.title;
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,144px)]"
                  >
                    <input
                      type="checkbox"
                      aria-label={gt("Include {title}", { title: row.title })}
                      checked={row.checked && current}
                      disabled={!current}
                      onChange={(event) => updateRow(row.key, { checked: event.target.checked })}
                    />
                    <div className="min-w-0 break-words">
                      <p>{row.title}</p>
                      <p className="text-xs text-muted-foreground">{row.reason}</p>
                    </div>
                    <select
                      aria-label={gt("Category for {title}", { title: row.title })}
                      className="col-start-2 min-w-0 rounded-md border bg-background p-1 text-xs sm:col-start-auto"
                      value={activeCategoryIds.has(row.id) ? row.id : ""}
                      disabled={!current}
                      onChange={(event) => updateRow(row.key, { id: event.target.value })}
                    >
                      {!activeCategoryIds.has(row.id) ? (
                        <option value="" disabled>
                          {gt("Select category")}
                        </option>
                      ) : null}
                      {categories.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {review ? (
            <span className="mr-auto text-xs text-muted-foreground">{review.model}</span>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            {gt("Cancel")}
          </Button>
          {review ? (
            <Button
              disabled={checked.length === 0}
              onClick={() => {
                if (onConfirm(checked.map(({ key, id }) => ({ key, id })))) onClose();
                else setError(gt("Could not save sidebar categories"));
              }}
            >
              {gt("Move {count} threads", { count: checked.length })}
            </Button>
          ) : (
            <Button
              disabled={pending || !permitted || batch.length === 0 || choices.length === 0}
              onClick={() => void request()}
            >
              {error ? gt("Retry") : gt("Get suggestions")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
