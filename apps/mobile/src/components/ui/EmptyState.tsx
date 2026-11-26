import { View } from "react-native";
import type { ReactNode } from "react";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { Button } from "./Button";

const EMPTY_STATE_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly icon?: AppSymbolName;
  readonly iconNode?: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly action?: ReactNode;
  readonly variant?: "card" | "plain";
}) {
  const visual = props.iconNode ? (
    <View className="mb-3 size-11 items-center justify-center rounded-full border border-border/60 bg-subtle">
      {props.iconNode}
    </View>
  ) : props.icon ? (
    <View className="mb-3 size-11 items-center justify-center rounded-full border border-border/60 bg-subtle">
      <SymbolView
        name={props.icon}
        size={20}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
    </View>
  ) : null;

  if (props.variant === "plain") {
    return (
      <Animated.View entering={EMPTY_STATE_ENTERING} className="items-center px-8 py-8">
        {visual}
        <Text textRole="title" className="text-center font-t3-bold text-foreground">
          {props.title}
        </Text>
        <Text
          textRole="body"
          className="mt-2 text-center font-sans leading-normal text-foreground-muted"
        >
          {props.detail}
        </Text>
        {props.action ? (
          <View className="mt-5">{props.action}</View>
        ) : props.actionLabel && props.onAction ? (
          <View className="mt-5">
            <Button tone="primary" label={props.actionLabel} onPress={props.onAction} />
          </View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={EMPTY_STATE_ENTERING}
      className="rounded-[22px] border border-border bg-card p-5"
    >
      {visual}
      <Text textRole="headline" className="font-t3-bold text-foreground">
        {props.title}
      </Text>
      <Text textRole="footnote" className="mt-2 font-sans leading-relaxed text-foreground-muted">
        {props.detail}
      </Text>
      {props.action ? (
        <View className="mt-4 self-start">{props.action}</View>
      ) : props.actionLabel && props.onAction ? (
        <View className="mt-4 self-start">
          <Button tone="primary" label={props.actionLabel} onPress={props.onAction} />
        </View>
      ) : null}
    </Animated.View>
  );
}
