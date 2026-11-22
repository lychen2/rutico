import { useState } from "react";
import { useGT } from "gt-react";

import { useSidebarCategories } from "../sidebar/SidebarCategories";
import type { SidebarCategoryPreset } from "../sidebar/SidebarCategoryRules";
import { Button } from "../ui/button";
import { SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function SidebarCategorySettingsSection() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const { state, setCategoryPreferences } = useSidebarCategories();
  // Existing v1 records without a preset keep their original categorization rules.
  const preset = state.preset ?? "legacy";
  const automatic = state.automatic ?? true;
  const [draft, setDraft] = useState<{ preset: SidebarCategoryPreset; automatic: boolean } | null>(
    null,
  );
  const selected = draft?.preset ?? preset;
  const enabled = draft?.automatic ?? automatic;
  const dirty = selected !== preset || enabled !== automatic;
  const [failed, setFailed] = useState(false);
  const presets = [
    { id: "general", name: gt("General preset"), description: gt("A bit of everything") },
    { id: "developer", name: gt("Developer"), description: gt("Mostly code") },
    { id: "creator", name: gt("Creator"), description: gt("Writing, video, and publishing") },
    { id: "project", name: gt("By project"), description: gt("Organize by folder") },
    {
      id: "legacy",
      name: gt("Previous categories"),
      description: gt("Keep the original sidebar rules"),
    },
  ] as const;
  return (
    <SettingsSection {...setting("sidebar-categories")}>
      <form
        className="space-y-4 p-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          if (setCategoryPreferences({ preset: selected, automatic: enabled })) {
            setDraft(null);
            setFailed(false);
          } else {
            setFailed(true);
          }
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">{gt("Category preset")}</legend>
          {presets.map(({ id, name, description }) => (
            <label key={id} className="flex items-center gap-3 rounded-lg border p-2">
              <input
                type="radio"
                name="sidebar-category-preset"
                checked={selected === id}
                onChange={() => setDraft({ preset: id, automatic: enabled })}
              />
              <span>
                {name}
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={selected === "project"}
            onChange={(event) => setDraft({ preset: selected, automatic: event.target.checked })}
          />
          {gt("Automatically categorize from titles")}
        </label>
        {failed ? (
          <p role="alert" className="text-error">
            {gt("Could not save sidebar categories")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setDraft(null);
              setFailed(false);
            }}
          >
            {gt("Cancel")}
          </Button>
          <Button type="submit" disabled={!dirty}>
            {gt("Save")}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
