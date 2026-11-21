import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { environmentCatalog } from "../../connection/catalog";
import { readLocalStorageValue, useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentPresentations } from "../../state/presentation";
import { environmentSnapshotAtom } from "../../state/shell";
import { threadFamilies } from "../../state/threads";

const Category = Schema.Struct({ id: Schema.String, name: Schema.String });
const SidebarCategories = Schema.Struct({
  categories: Schema.Array(Category),
  assignments: Schema.Record(Schema.String, Schema.String),
  collapsed: Schema.Array(Schema.String),
});

type SidebarCategories = typeof SidebarCategories.Type;
export type SidebarCategory = typeof Category.Type;

export const SIDEBAR_CATEGORIES_STORAGE_KEY = "t3code:sidebar-categories:v1";
export const UNCATEGORIZED = "uncategorized";
const EMPTY_CATEGORIES: SidebarCategories = { categories: [], assignments: {}, collapsed: [] };

const missingAssignedThreads = Atom.family((assignmentKeys: string) => {
  const assignedByEnvironment = new Map<EnvironmentId, ThreadId[]>();
  for (const key of JSON.parse(assignmentKeys) as string[]) {
    const ref = parseScopedThreadKey(key);
    if (ref === null) continue;
    const ids = assignedByEnvironment.get(ref.environmentId);
    if (ids === undefined) assignedByEnvironment.set(ref.environmentId, [ref.threadId]);
    else ids.push(ref.threadId);
  }
  return Atom.make((get) => {
    if (assignedByEnvironment.size === 0) return "[]";
    const configs = get(environmentPresentations.serverConfigsAtom);
    const missing: [EnvironmentId, ThreadId][] = [];
    for (const environmentId of enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom))) {
      const ids = assignedByEnvironment.get(environmentId);
      if (ids === undefined || configs.get(environmentId)?.shellThreadFamilies !== true) continue;
      const snapshot = get(environmentSnapshotAtom(environmentId));
      if (snapshot === null) continue;
      const missingIds = new Set(ids);
      for (const thread of snapshot.threads) {
        if (missingIds.delete(thread.id) && missingIds.size === 0) break;
      }
      for (const id of missingIds) missing.push([environmentId, id]);
    }
    return JSON.stringify(missing);
  });
});

export function useSidebarCategories() {
  const [state, setState] = useLocalStorage(
    SIDEBAR_CATEGORIES_STORAGE_KEY,
    EMPTY_CATEGORIES,
    SidebarCategories,
  );
  const missing = useAtomValue(
    missingAssignedThreads(JSON.stringify(Object.keys(state.assignments))),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts assigned older settled rows omitted from the base shell, independently of the unclassified shelf
  useEffect(() => {
    const releases = (JSON.parse(missing) as [EnvironmentId, ThreadId][]).map(
      ([environmentId, id]) => threadFamilies.mount(appAtomRegistry, environmentId, id),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [missing]);
  const readSaved = () =>
    readLocalStorageValue(SIDEBAR_CATEGORIES_STORAGE_KEY, EMPTY_CATEGORIES, SidebarCategories);

  const createCategory = (name: string) => {
    const id = randomUUID();
    setState((current) => ({ ...current, categories: [...current.categories, { id, name }] }));
    return readSaved().categories.some((category) => category.id === id);
  };
  const moveToCategory = (keys: readonly string[], id: string) => {
    setState((current) => {
      if (id !== UNCATEGORIZED && !current.categories.some((category) => category.id === id)) {
        return current;
      }
      const assignments = { ...current.assignments };
      for (const key of keys) {
        if (id === UNCATEGORIZED) delete assignments[key];
        else assignments[key] = id;
      }
      return { ...current, assignments, collapsed: current.collapsed.filter((key) => key !== id) };
    });
    const saved = readSaved();
    return (
      !saved.collapsed.includes(id) &&
      keys.every((key) => (saved.assignments[key] ?? UNCATEGORIZED) === id)
    );
  };
  const toggleCategory = (id: string) => {
    setState((current) => ({
      ...current,
      collapsed: current.collapsed.includes(id)
        ? current.collapsed.filter((key) => key !== id)
        : [...current.collapsed, id],
    }));
  };

  return { state, createCategory, moveToCategory, toggleCategory };
}
