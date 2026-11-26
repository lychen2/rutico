import * as Haptics from "expo-haptics";
import { T, useGT } from "gt-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText } from "./AppText";
import { ListRowLayout, type ListRowContentProps } from "./ListRowLayout";
import { RowPressable } from "./RowPressable";
import { ThemedSwitch } from "./ThemedSwitch";

/**
 * A mixed row flips the value last picked on it, so a pick that some environments dropped can be
 * undone. Before any pick, it sets the value on everywhere.
 */
export function ListToggleRow(
  props: Omit<ListRowContentProps, "detail"> & {
    readonly value: boolean | null;
    readonly onValueChange: (value: boolean) => void;
  },
) {
  const gt = useGT();
  const [picked, setPicked] = useState(false);
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const disabled = Boolean(props.disabled);
  const pick = (value: boolean) => {
    setPicked(value);
    props.onValueChange(value);
  };
  const isMixed = props.value === null;
  const mixedAccessibilityLabel = picked
    ? gt("Set {label} off for selected environments", { label: props.label })
    : gt("Set {label} on for selected environments", { label: props.label });
  const handleRowPress = () => {
    if (disabled) return;
    void Haptics.selectionAsync().catch(() => undefined);
    pick(isMixed ? !picked : !props.value);
  };

  return (
    <RowPressable
      accessibilityRole={isMixed ? "button" : "switch"}
      accessibilityLabel={isMixed ? mixedAccessibilityLabel : props.label}
      accessibilityHint={props.description}
      accessibilityState={isMixed ? { disabled } : { checked: props.value, disabled }}
      disabled={disabled}
      onPress={handleRowPress}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className="bg-grouped-card"
    >
      <ListRowLayout
        icon={props.icon}
        label={props.label}
        description={props.description}
        disabled={disabled}
        accessory={
          isMixed ? (
            <View className="min-h-[44px] items-center justify-center rounded-full bg-subtle px-3.5 py-2 android:min-h-[48px]">
              <AppText className="text-sm font-t3-medium text-foreground">
                {picked ? <T>Mixed · Set off</T> : <T>Mixed · Set on</T>}
              </AppText>
            </View>
          ) : (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <ThemedSwitch
                accessibilityLabel={props.label}
                accessibilityHint={props.description}
                disabled={disabled}
                style={{ alignSelf: "center" }}
                onValueChange={pick}
                value={props.value}
              />
            </View>
          )
        }
      />
    </RowPressable>
  );
}
