import { Button } from "../../components/ui/Button";
import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  RuntimeRequestId,
} from "@t3tools/contracts";
import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import * as Haptics from "expo-haptics";
import { T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ThreadDisclosureChevron } from "../../components/ui/ThreadDisclosureChevron";
import type { PendingApproval } from "../../lib/threadActivity";

export interface PendingApprovalCardProps {
  readonly canOperateThread: boolean;
  readonly approval: PendingApproval;
  readonly respondingApprovalId: RuntimeRequestId | null;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const gt = useGT();
  const m = useMessages();
  const options: ReadonlyArray<ProviderApprovalOption> = props.approval.options ?? [
    { decision: "accept", label: gt("Allow once") },
    { decision: "acceptForSession", label: gt("Allow session") },
    {
      decision: "decline",
      label: gt("Decline", { $context: "verb, rejects the approval request" }),
    },
  ];
  const warning = options.find((option) => option.warning)?.warning;
  const canRespond = props.approval.responseCapability === "live";
  const isResponding = props.respondingApprovalId === props.approval.requestId;
  const disabled = !canRespond || isResponding;
  const [pendingDecision, setPendingDecision] = useState<ProviderApprovalDecision | null>(null);
  const activeDecision = isResponding ? pendingDecision : null;
  const [explanationOpen, setExplanationOpen] = useState(false);
  return (
    <View className="gap-2.5 rounded-[20px] border border-warning-border bg-card-alt p-4">
      <View className="flex-row items-center gap-1.5">
        <SymbolView
          name="exclamationmark.shield"
          size={12}
          tintColorClassName="accent-warning-foreground"
          type="monochrome"
        />
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-warning-foreground">
          <T>Approval needed</T>
        </Text>
      </View>
      <Text className="font-t3-bold text-lg text-foreground">
        {props.approval.appName ?? props.approval.requestKind}
      </Text>
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {props.approval.detail}
        </Text>
      ) : null}
      {props.approval.reason ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">
          {props.approval.reason}
        </Text>
      ) : null}
      {props.approval.fullAccessOverride ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: explanationOpen }}
            hitSlop={4}
            className="min-h-[40px] flex-row items-center gap-1.5 py-1.5 active:opacity-70"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              setExplanationOpen((open) => !open);
            }}
          >
            <ThreadDisclosureChevron
              expanded={explanationOpen}
              collapsedDirection="right"
              size={11}
              tintColorClassName="accent-icon-muted"
            />
            <Text className="font-t3-medium text-xs text-foreground-secondary">
              {m(FULL_ACCESS_OVERRIDE_QUESTION)}
            </Text>
          </Pressable>
          {explanationOpen ? (
            <Text className="pb-1 pl-4 font-sans text-xs leading-normal text-foreground-muted">
              {fullAccessOverrideExplanation(props.approval.fullAccessOverride, m)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!canRespond ? (
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          <T>
            The provider process for this request is no longer available. Interrupt or restart the
            run to continue.
          </T>
        </Text>
      ) : null}
      {warning ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">{warning}</Text>
      ) : null}
      <View className="gap-2">
        {options.map((option) => (
          <Button
            key={option.decision}
            label={option.label}
            tone={
              option.decision === "accept"
                ? "primary"
                : option.decision === "decline"
                  ? "danger"
                  : "secondary"
            }
            loading={activeDecision === option.decision}
            disabled={disabled || !props.canOperateThread}
            onPress={() => {
              setPendingDecision(option.decision);
              void Haptics.notificationAsync(
                option.decision === "decline"
                  ? Haptics.NotificationFeedbackType.Warning
                  : Haptics.NotificationFeedbackType.Success,
              ).catch(() => undefined);
              void props.onRespond(props.approval.requestId, option.decision);
            }}
            fullWidth
          />
        ))}
      </View>
      {!props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-muted">
          <T>This connection cannot respond to approvals.</T>
        </Text>
      ) : null}
    </View>
  );
}
