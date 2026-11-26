import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  PullRequestContextMetadata,
  ScopedThreadRef,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { ComposerTriggerKind } from "@t3tools/shared/composerTrigger";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { msg, useMessages } from "gt-react-native";
import { memo, useEffect } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { ProviderIcon } from "../../components/ProviderIcon";
import type { MessageResolver } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import type { ModelOption } from "../../lib/modelOptions";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
export type ComposerCommandItem =
  | {
      readonly id: string;
      readonly type: "pull-request";
      readonly pullRequest: PullRequestContextMetadata;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "thread";
      readonly thread: ScopedThreadRef;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "environment";
      readonly environmentId: EnvironmentId;
      readonly machine: EnvironmentMachineKind;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "model";
      readonly option: ModelOption;
      readonly label: string;
      readonly description: string;
    };

interface ComposerCommandPopoverProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly isLoading: boolean;
  readonly error?: string | null;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

const POPOVER_ENTERING = FadeInDown.duration(150).reduceMotion(ReduceMotion.System);
const POPOVER_EXITING = FadeOutDown.duration(120).reduceMotion(ReduceMotion.System);
const POPOVER_ROW_HEIGHT = Platform.OS === "android" ? 48 : 44;
const POPOVER_MAX_LIST_HEIGHT = 240;

function PopoverSurface(props: { readonly children: React.ReactNode; readonly style?: ViewStyle }) {
  const baseStyle: ViewStyle = {
    borderRadius: 16,
    ...props.style,
  };

  return (
    <Animated.View entering={POPOVER_ENTERING} exiting={POPOVER_EXITING}>
      <GlassSurface
        glassEffectStyle="clear"
        tintColorClassName="accent-glass-surface"
        style={baseStyle}
      >
        {props.children}
      </GlassSurface>
    </Animated.View>
  );
}

const SKILL_SOURCE_SYMBOL_BY_KIND: Record<ProviderSkillSourceKind, AppSymbolName> = {
  app: "square.grid.2x2",
  repo: "folder",
  project: "folder",
  personal: "person.crop.circle",
  system: "gearshape",
  other: "cube",
};

function itemIcon(item: ComposerCommandItem): AppSymbolName | null {
  switch (item.type) {
    case "pull-request":
      return pullRequestStatus(item.pullRequest).icon;
    case "slash-command":
    case "provider-slash-command":
      return "terminal";
    case "skill":
      return SKILL_SOURCE_SYMBOL_BY_KIND[resolveProviderSkillSourceKind(item.skill)];
    case "path":
    case "model":
      return null;
    case "thread":
      return "text.bubble";
    case "environment":
      return ENVIRONMENT_MACHINE_SYMBOLS[item.machine];
  }
}

function groupLabel(
  triggerKind: ComposerTriggerKind | null,
  items: ReadonlyArray<ComposerCommandItem>,
  resolve: MessageResolver,
): string | null {
  switch (triggerKind) {
    case "pull-request":
      return resolve(msg("Pull requests"));
    case "slash-command":
      return resolve(msg("Commands"));
    case "skill":
      return resolve(msg("Skills"));
    case "path":
      return items.every((item) => item.type === "path")
        ? resolve(msg("Files"))
        : resolve(msg("Mentions"));
    default:
      return null;
  }
}

function emptyText(
  triggerKind: ComposerTriggerKind | null,
  isLoading: boolean,
  resolve: MessageResolver,
): string {
  if (isLoading) {
    return triggerKind === "path" ? resolve(msg("Searching files…")) : resolve(msg("Loading…"));
  }
  switch (triggerKind) {
    case "pull-request":
      return resolve(msg("No matching pull requests."));
    case "path":
      return resolve(msg("No matching mentions."));
    case "skill":
      return resolve(msg("No skills found."));
    case "slash-command":
      return resolve(msg("No matching commands."));
    default:
      return resolve(msg("No results."));
  }
}

const CommandRow = memo(function CommandRow(props: {
  readonly item: ComposerCommandItem;
  readonly onPress: () => void;
  readonly isLast: boolean;
  readonly isSlashSkill: boolean;
}) {
  const iconName = itemIcon(props.item);

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => {
        triggerSemanticHaptic("clockTick");
      }}
      onPress={() => {
        triggerSemanticHaptic("contextClick");
        props.onPress();
      }}
      className="min-h-[44px] flex-row items-center gap-2.5 border-border px-3.5 py-2.5 active:opacity-60 android:min-h-[48px]"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon path={props.item.path} kind={props.item.kind} size={16} />
      ) : props.item.type === "model" ? (
        <ProviderIcon
          iconUrl={props.item.option.providerIconUrl}
          provider={props.item.option.providerDriver}
          size={16}
        />
      ) : iconName ? (
        <SymbolView
          name={iconName}
          size={14}
          tintColorClassName={
            props.item.type === "pull-request"
              ? pullRequestStatus(props.item.pullRequest).tint
              : "accent-icon-subtle"
          }
          type="monochrome"
        />
      ) : null}
      <Text
        className={cn(
          "shrink-0 text-base font-t3-medium text-foreground",
          props.item.type === "thread" && "max-w-[45%]",
        )}
        numberOfLines={1}
      >
        {props.isSlashSkill && props.item.type === "skill" ? (
          <>
            <Text className="text-foreground-muted">skill:</Text>
            {formatProviderSkillDisplayName(props.item.skill)}
          </>
        ) : (
          props.item.label
        )}
      </Text>
      {props.item.description ? (
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {props.item.description}
        </Text>
      ) : null}
    </Pressable>
  );
});

export const ComposerCommandPopover = memo(function ComposerCommandPopover(
  props: ComposerCommandPopoverProps,
) {
  const m = useMessages();
  const label = groupLabel(props.triggerKind, props.items, m);
  const targetListHeight = Math.min(
    POPOVER_MAX_LIST_HEIGHT,
    Math.max(POPOVER_ROW_HEIGHT, props.items.length * POPOVER_ROW_HEIGHT),
  );
  const animatedListHeight = useSharedValue(targetListHeight);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- smoothly spring-morphs the command popover height as filtered matches change
  useEffect(() => {
    animatedListHeight.set(withSpring(targetListHeight, SPRING_SPATIAL_SNAPPY));
  }, [animatedListHeight, targetListHeight]);

  const listHeightStyle = useAnimatedStyle(() => ({
    maxHeight: animatedListHeight.get(),
  }));

  return (
    <PopoverSurface>
      {label ? (
        <View className="px-3.5 pt-2.5 pb-1">
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {label}
          </Text>
        </View>
      ) : null}
      {props.items.length > 0 ? (
        <Animated.View style={listHeightStyle}>
          <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
            {props.items.map((item, index) => (
              <CommandRow
                key={item.id}
                item={item}
                onPress={() => props.onSelect(item)}
                isLast={index === props.items.length - 1}
                isSlashSkill={props.triggerKind === "slash-command" && item.type === "skill"}
              />
            ))}
          </ScrollView>
        </Animated.View>
      ) : props.error ? (
        <View className="px-3.5 py-2.5">
          <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
            {props.error}
          </Text>
        </View>
      ) : props.isLoading ? (
        <View className="flex-row items-center gap-2 px-3.5 py-2.5">
          <AppActivityIndicator size="small" colorClassName="accent-foreground-muted" />
          <Text className="text-xs text-foreground-tertiary">
            {emptyText(props.triggerKind, true, m)}
          </Text>
        </View>
      ) : (
        <View className="px-3.5 py-2.5">
          <Text className="text-xs text-foreground-tertiary">
            {emptyText(props.triggerKind, false, m)}
          </Text>
        </View>
      )}
    </PopoverSurface>
  );
});
