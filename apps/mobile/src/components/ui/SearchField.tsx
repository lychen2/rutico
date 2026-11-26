import * as Haptics from "expo-haptics";
import { useState, type RefObject } from "react";
import { Pressable, TextInput, type TextInputInstance, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { cn } from "../../lib/cn";
import { SymbolView } from "./AppSymbol";
import { useAndroidControlSizing } from "./useAndroidControlSizing";

const CLEAR_BUTTON_ENTERING = FadeIn.duration(120).reduceMotion(ReduceMotion.System);
const CLEAR_BUTTON_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);

export interface SearchFieldProps {
  readonly autoFocus?: boolean;
  readonly inputRef: RefObject<TextInputInstance | null>;
  readonly accessibilityLabel: string;
  readonly clearAccessibilityLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
}

export function SearchField({
  inputRef,
  autoFocus = true,
  accessibilityLabel,
  clearAccessibilityLabel,
  placeholder,
  value,
  onChangeText,
}: SearchFieldProps) {
  const { scale, mediumIconSize } = useAndroidControlSizing();
  const [focused, setFocused] = useState(false);

  return (
    <View
      className={cn(
        "min-w-0 flex-1 flex-row items-center rounded-full border bg-input",
        focused ? "border-focus" : "border-input-border",
      )}
      style={{
        minHeight: Math.max(48, 42 * scale),
        gap: 7 * scale,
        paddingHorizontal: 10.5 * scale,
      }}
    >
      <SymbolView
        name="magnifyingglass"
        size={mediumIconSize}
        tintColorClassName="accent-foreground-muted"
      />
      <TextInput
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColorClassName="accent-placeholder"
        selectionColorClassName="accent-focus/32"
        cursorColorClassName="accent-focus"
        selectionHandleColorClassName="accent-focus"
        className="min-w-0 flex-1 font-sans text-base text-foreground"
        style={{ minHeight: Math.max(48, 42 * scale), paddingVertical: 7 * scale }}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {value.length > 0 ? (
        <Animated.View entering={CLEAR_BUTTON_ENTERING} exiting={CLEAR_BUTTON_EXITING}>
          <Pressable
            accessibilityLabel={clearAccessibilityLabel}
            accessibilityRole="button"
            hitSlop={10}
            className="active:opacity-60"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChangeText("");
              inputRef.current?.focus();
            }}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={mediumIconSize}
              tintColorClassName="accent-foreground-muted"
            />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
