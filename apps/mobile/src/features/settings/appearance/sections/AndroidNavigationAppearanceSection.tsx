import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { SymbolView } from "../../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { cn } from "../../../../lib/cn";
import { PullRequestGlyph } from "../../../pull-requests/pullRequestGlyphs";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const PREVIEW_TABS = [
  { id: "threads", icon: "bubble.left.and.bubble.right" },
  { id: "pullRequests", icon: PullRequestGlyph.pullRequest },
  { id: "issues", icon: "exclamationmark.circle" },
  { id: "settings", icon: "gearshape" },
] as const;

const PILL_SPRING = {
  damping: 22,
  stiffness: 320,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
} as const;

function triggerSegmentTick(): void {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(
      () => undefined,
    );
  } else {
    void Haptics.selectionAsync().catch(() => undefined);
  }
}

function NavigationStyleMiniPreview(props: { readonly style: "one-ui" | "material" }) {
  const gt = useGT();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const indicatorX = useSharedValue(0);

  const slotWidth = trackWidth > 0 ? trackWidth / PREVIEW_TABS.length : 0;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives Reanimated spring pill inside interactive settings preview
  useEffect(() => {
    if (slotWidth <= 0) return;
    indicatorX.set(withSpring(selectedIndex * slotWidth, PILL_SPRING));
  }, [indicatorX, selectedIndex, slotWidth]);

  const pillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, slotWidth - 6),
    transform: [{ translateX: indicatorX.get() + 3 }],
  }));

  const floating = props.style === "one-ui";

  return (
    <View
      className="px-4 pb-3 pt-4"
      accessibilityLabel={gt("Interactive navigation style preview")}
    >
      <View className="overflow-hidden rounded-[20px] border border-border bg-screen px-3 pb-3 pt-4">
        <View className="mb-3 gap-1.5 px-1">
          <View className="h-2 w-24 rounded-full bg-subtle-strong" />
          <View className="h-1.5 w-36 rounded-full bg-subtle" />
        </View>
        {floating ? (
          <View className="flex-row items-center gap-2.5">
            <View
              onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
              className="relative h-11 flex-1 flex-row items-center overflow-hidden rounded-full border border-border/70 bg-card"
            >
              {slotWidth > 0 ? (
                <Animated.View
                  pointerEvents="none"
                  className="absolute bottom-1 top-1 rounded-full bg-secondary"
                  style={pillStyle}
                />
              ) : null}
              {PREVIEW_TABS.map((tab, index) => {
                const selected = index === selectedIndex;
                return (
                  <Pressable
                    key={tab.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    className="h-full flex-1 items-center justify-center"
                    onPress={() => {
                      if (!selected) triggerSegmentTick();
                      setSelectedIndex(index);
                    }}
                  >
                    <SymbolView
                      name={tab.icon}
                      size={16}
                      tintColorClassName={selected ? "accent-primary" : "accent-icon-muted"}
                    />
                  </Pressable>
                );
              })}
            </View>
            <View className="size-11 items-center justify-center rounded-full bg-primary">
              <SymbolView name="plus" size={16} tintColorClassName="accent-primary-foreground" />
            </View>
          </View>
        ) : (
          <View
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            className="relative -mx-3 -mb-3 h-13 flex-row items-center border-t border-border bg-card"
          >
            {slotWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                className="absolute top-2 h-7 rounded-full bg-secondary"
                style={pillStyle}
              />
            ) : null}
            {PREVIEW_TABS.map((tab, index) => {
              const selected = index === selectedIndex;
              return (
                <Pressable
                  key={tab.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  className="h-full flex-1 items-center justify-center gap-0.5"
                  onPress={() => {
                    if (!selected) triggerSegmentTick();
                    setSelectedIndex(index);
                  }}
                >
                  <SymbolView
                    name={tab.icon}
                    size={15}
                    tintColorClassName={selected ? "accent-primary" : "accent-icon-muted"}
                  />
                  <View
                    className={cn(
                      "h-1 w-6 rounded-full",
                      selected ? "bg-foreground" : "bg-foreground-muted/35",
                    )}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      <Text className="mt-2 px-1 text-xs text-foreground-muted">
        {gt("Tap tabs above to preview the sliding indicator")}
      </Text>
    </View>
  );
}

export function AndroidNavigationAppearanceSection() {
  const gt = useGT();
  const { isReady, androidNavigationStyle, setAndroidNavigationStyle } = useAppearancePreferences();
  return (
    <SettingsSection title={gt("Navigation", { $context: "navigation bar style" })}>
      <NavigationStyleMiniPreview style={androidNavigationStyle} />
      <View accessibilityRole="radiogroup">
        <SettingsChoiceRow
          label="One UI"
          description={gt("Floating navigation with a separate compose button.")}
          disabled={!isReady}
          selected={androidNavigationStyle === "one-ui"}
          onPress={() => {
            if (androidNavigationStyle !== "one-ui") triggerSegmentTick();
            setAndroidNavigationStyle("one-ui");
          }}
        />
        <SettingsChoiceRow
          label="Material"
          description={gt("Standard Android navigation bar and side rail.")}
          disabled={!isReady}
          selected={androidNavigationStyle === "material"}
          onPress={() => {
            if (androidNavigationStyle !== "material") triggerSegmentTick();
            setAndroidNavigationStyle("material");
          }}
          separated
        />
      </View>
    </SettingsSection>
  );
}
