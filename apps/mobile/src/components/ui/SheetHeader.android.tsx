import { useGT } from "gt-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_EFFECTS_FAST } from "../../lib/mobileMotion";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AppBar } from "./AppBar";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import type { SheetCloseButtonProps, SheetHeaderProps } from "./SheetHeader.types";

function TactileHeaderAction(props: { readonly children: ReactNode }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  return (
    <Animated.View
      style={animatedStyle}
      onTouchStart={() => {
        scale.set(withSpring(0.94, SPRING_EFFECTS_FAST));
      }}
      onTouchEnd={() => {
        scale.set(withSpring(1, SPRING_EFFECTS_FAST));
      }}
      onTouchCancel={() => {
        scale.set(withSpring(1, SPRING_EFFECTS_FAST));
      }}
    >
      {props.children}
    </Animated.View>
  );
}

export function SheetCloseButton(props: SheetCloseButtonProps) {
  const gt = useGT();
  const handlePress = props.onCancel ?? props.onClose;
  return (
    <TactileHeaderAction>
      <IconButton
        icon="xmark"
        accessibilityLabel={
          props.accessibilityLabel ?? (props.onCancel ? gt("Cancel") : gt("Close"))
        }
        disabled={props.disabled}
        tintColorClassName="accent-header-foreground"
        onPress={() => {
          triggerSemanticHaptic("contextClick");
          handlePress?.();
        }}
      />
    </TactileHeaderAction>
  );
}

export function SheetHeader(props: SheetHeaderProps) {
  const confirmation = props.confirm;
  const trailing =
    props.trailing || confirmation ? (
      <View className="flex-row items-center gap-2">
        {props.trailing}
        {confirmation ? (
          <TactileHeaderAction>
            <Button
              label={confirmation.label}
              tone="text"
              loading={confirmation.loading}
              disabled={confirmation.disabled}
              onPress={() => {
                triggerSemanticHaptic("contextClick");
                confirmation.onPress();
              }}
            />
          </TactileHeaderAction>
        ) : null}
      </View>
    ) : undefined;

  return (
    <>
      {props.dismissDisabled === undefined ? null : (
        // A sheet that can't be closed with its button can't be swiped away either.
        <NativeStackScreenOptions options={{ gestureEnabled: !props.dismissDisabled }} />
      )}
      <AppBar
        embedded
        sheet={props.presentation === "inline"}
        title={props.title}
        subtitle={props.subtitle}
        actions={props.actions}
        menus={props.menus}
        leading={
          <SheetCloseButton
            {...(props.onCancel ? { onCancel: props.onCancel } : { onClose: props.onClose })}
            accessibilityLabel={props.accessibilityLabel}
            disabled={props.dismissDisabled}
          />
        }
        trailing={trailing}
        hideBottomBorder
      />
    </>
  );
}
