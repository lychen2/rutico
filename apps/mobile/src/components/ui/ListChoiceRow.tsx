import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { useResolveClassNames } from "uniwind";

import { cn } from "../../lib/cn";
import { SymbolView } from "./AppSymbol";
import { ListRowLayout } from "./ListRowLayout";
import { RadioIndicator } from "./RadioIndicator";
import { RowPressable } from "./RowPressable";

const CHECKMARK_ENTERING = ZoomIn.duration(140).reduceMotion(ReduceMotion.System);

export function ListChoiceRow(props: {
  readonly label: string;
  readonly leading?: ReactNode;
  readonly description?: string;
  readonly meta?: ReactNode;
  readonly selected: boolean;
  readonly separated?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  return (
    <RowPressable
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityHint={props.description}
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        props.onPress();
      }}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      // Like UIKit and Material lists, only the checkmark or radio marks the selected row.
      className={cn("bg-grouped-card", props.separated && "border-t border-border-subtle")}
    >
      <ListRowLayout
        label={props.label}
        leading={props.leading}
        description={props.description}
        meta={props.meta}
        disabled={props.disabled}
        accessory={
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="size-6 items-center justify-center"
          >
            {Platform.OS === "android" ? (
              <RadioIndicator selected={props.selected} />
            ) : props.selected ? (
              <Animated.View entering={CHECKMARK_ENTERING}>
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColorClassName="accent-primary-text"
                  type="monochrome"
                  weight="semibold"
                />
              </Animated.View>
            ) : null}
          </View>
        }
      />
    </RowPressable>
  );
}
