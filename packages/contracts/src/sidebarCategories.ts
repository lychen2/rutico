import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";
import {
  isProviderAvailable,
  isProviderTextGenerationCapable,
  type ServerProvider,
} from "./server.ts";

export const SIDEBAR_SUGGESTION_MAX_TITLES = 30;
export const SIDEBAR_SUGGESTION_MAX_CATEGORIES = 40;
export const SIDEBAR_SUGGESTION_MAX_TITLE_LENGTH = 500;
export const SIDEBAR_SUGGESTION_MAX_CATEGORY_LENGTH = 120;

export const SidebarCategorySuggestionInput = Schema.Struct({
  titles: Schema.Array(
    Schema.String.check(Schema.isMaxLength(SIDEBAR_SUGGESTION_MAX_TITLE_LENGTH)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(SIDEBAR_SUGGESTION_MAX_TITLES)),
  categories: Schema.Array(
    Schema.String.check(Schema.isMaxLength(SIDEBAR_SUGGESTION_MAX_CATEGORY_LENGTH)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(SIDEBAR_SUGGESTION_MAX_CATEGORIES)),
  modelSelection: Schema.NullOr(ModelSelection),
  language: Schema.Literals(["en", "zh"]),
});
export type SidebarCategorySuggestionInput = typeof SidebarCategorySuggestionInput.Type;

export const SidebarCategorySuggestionRow = Schema.Struct({
  titleIndex: Schema.Int,
  categoryIndex: Schema.Int,
  reason: Schema.String.check(Schema.isMaxLength(240)),
});

export const SidebarCategorySuggestionOutput = Schema.Struct({
  model: Schema.String,
  suggestions: Schema.Array(SidebarCategorySuggestionRow).check(
    Schema.isMaxLength(SIDEBAR_SUGGESTION_MAX_TITLES),
  ),
});

export class SidebarCategorySuggestionError extends Schema.TaggedError<SidebarCategorySuggestionError>()(
  "SidebarCategorySuggestionError",
  { reason: Schema.Literals(["noModel", "noPrice", "generationFailed"]) },
) {}

export function sidebarSuggestionModels(providers: readonly ServerProvider[]) {
  return providers.flatMap((provider) => {
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.status !== "ready" ||
      provider.auth.status === "unauthenticated" ||
      provider.compatibilityAdvisory?.status === "broken" ||
      !isProviderAvailable(provider) ||
      !isProviderTextGenerationCapable(provider)
    )
      return [];
    return provider.models.flatMap((model) =>
      model.supportsTextGeneration !== false && !model.isLegacy
        ? [
            {
              selection: { instanceId: provider.instanceId, model: model.slug },
              label: `${provider.displayName?.trim() || provider.driver} · ${model.name}`,
            },
          ]
        : [],
    );
  });
}
