import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { T, useGT } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { useSideChats } from "../../state/entities";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

const SIDE_CHATS_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const SIDE_CHATS_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

/**
 * The thread's side chats, started on web or desktop. Each opens as a normal thread, so its
 * approvals and questions can be answered from the phone.
 */
export function ThreadSideChatsRow(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const sideChats = useSideChats({ environmentId: props.environmentId, threadId: props.threadId });
  const openLinkedThread = useOpenLinkedThread();
  const gt = useGT();
  if (sideChats.length === 0) return null;
  return (
    <Animated.View
      entering={SIDE_CHATS_ENTERING}
      exiting={SIDE_CHATS_EXITING}
      className="flex-row items-center gap-2 bg-transparent py-2 pl-4"
    >
      <SymbolView
        name="bubble.left.and.bubble.right"
        size={12}
        tintColorClassName="accent-foreground-muted"
      />
      <Text className="text-xs text-foreground-muted">
        <T>Side chats</T>
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
        <View className="flex-row gap-1.5 pr-4">
          {sideChats.map((sideChat) => {
            const needs =
              sideChat.hasPendingApprovals || sideChat.pendingSubagentRequest === "approval"
                ? "approval"
                : sideChat.hasPendingUserInput || sideChat.pendingSubagentRequest
                  ? "input"
                  : null;
            return (
              <Pressable
                key={sideChat.id}
                accessibilityRole="button"
                accessibilityLabel={
                  needs === null
                    ? gt("Open side chat {title}", { title: sideChat.title })
                    : needs === "approval"
                      ? gt("Open side chat {title}, needs approval", { title: sideChat.title })
                      : gt("Open side chat {title}, needs input", { title: sideChat.title })
                }
                hitSlop={8}
                className="min-h-[32px] max-w-48 flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  openLinkedThread({ environmentId: props.environmentId, threadId: sideChat.id });
                }}
              >
                {needs === null ? null : (
                  <View
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      needs === "approval" ? "bg-warning-foreground" : "bg-adaptive-indigo-600-300",
                    )}
                  />
                )}
                <Text className="shrink text-xs text-foreground" numberOfLines={1}>
                  {sideChat.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Animated.View>
  );
}
