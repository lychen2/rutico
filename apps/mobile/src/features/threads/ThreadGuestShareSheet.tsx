import { useAtomValue } from "@effect/atom-react";
import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadGuestShare, ThreadId } from "@t3tools/contracts";
import { QrCode } from "@t3tools/shared/qrCode";
import { msg, T, useGT, useMessages } from "gt-react-native";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, Share, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Path, Rect } from "react-native-svg";

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useDeadlinePassed, useNowMinuteMs } from "../../lib/clock";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { serverEnvironment } from "../../state/server";
import { environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadGuestShare } from "./ThreadGuestShareBar";

const TITLE = msg("Share with guest");
const COPY_FEEDBACK_DURATION_MS = 1200;
const GUEST_QR_MARGIN = 2;
const PENDING_MESSAGES_NOTICE = msg(
  "Send or dismiss pending guest messages in the thread before creating a new link.",
);

export interface GuestPassQrSvgData {
  readonly size: number;
  readonly viewBoxSize: number;
  readonly modulesPath: string;
  readonly finderEyes: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly moduleCount: number;
}

function isFinderModule(x: number, y: number, size: number): boolean {
  const top = y >= 0 && y < 7;
  const bottom = y >= size - 7 && y < size;
  const left = x >= 0 && x < 7;
  const right = x >= size - 7 && x < size;
  return (top && left) || (top && right) || (bottom && left);
}

/**
 * Encodes a Guest Live Pass URL into rounded-module + dual-ring finder-eye SVG geometry
 * using `@t3tools/shared/qrCode` directly with zero extra dependencies.
 */
export function buildGuestPassQrSvg(url: string): GuestPassQrSvgData {
  const qr = QrCode.encodeText(url, QrCode.Ecc.MEDIUM);
  const size = qr.size;
  const viewBoxSize = size + GUEST_QR_MARGIN * 2;
  const inset = 0.07;
  const side = 1 - inset * 2;
  const radius = 0.3;
  const straight = side - radius * 2;
  const parts: Array<string> = [];
  let moduleCount = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!qr.getModule(x, y)) continue;
      if (isFinderModule(x, y, size)) continue;
      moduleCount += 1;
      const left = (x + GUEST_QR_MARGIN + inset).toFixed(2);
      const top = (y + GUEST_QR_MARGIN + inset).toFixed(2);
      parts.push(
        `M${(Number(left) + radius).toFixed(2)} ${top}` +
          `h${straight.toFixed(2)}` +
          `a${radius} ${radius} 0 0 1 ${radius} ${radius}` +
          `v${straight.toFixed(2)}` +
          `a${radius} ${radius} 0 0 1 -${radius} ${radius}` +
          `h-${straight.toFixed(2)}` +
          `a${radius} ${radius} 0 0 1 -${radius} -${radius}` +
          `v-${straight.toFixed(2)}` +
          `a${radius} ${radius} 0 0 1 ${radius} -${radius}z`,
      );
    }
  }

  return {
    size,
    viewBoxSize,
    modulesPath: parts.join(""),
    finderEyes: [
      { x: 0, y: 0 },
      { x: size - 7, y: 0 },
      { x: 0, y: size - 7 },
    ],
    moduleCount,
  };
}

export function formatGuestPassCountdown(expiresAtIso: string, nowMs: number): string {
  const remainingMs = Date.parse(expiresAtIso) - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "0m";
  }
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

function GuestPassQrCard(props: {
  readonly url: string;
  readonly expiresAt: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly onShare: () => void;
}) {
  const gt = useGT();
  const nowMinuteMs = useNowMinuteMs();
  const qr = useMemo(() => buildGuestPassQrSvg(props.url), [props.url]);
  const countdown = formatGuestPassCountdown(props.expiresAt, nowMinuteMs);
  const enterProgress = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- springs the Guest Live Pass card into view once the share link is minted
  useEffect(() => {
    enterProgress.set(withSpring(1, SPRING_SPATIAL_SNAPPY));
  }, [enterProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enterProgress.get(),
    transform: [
      { translateY: (1 - enterProgress.get()) * 14 },
      { scale: 0.97 + enterProgress.get() * 0.03 },
    ],
  }));

  return (
    <Animated.View collapsable={false} style={cardStyle} className="gap-4">
      <View
        collapsable={false}
        className="items-center gap-4 rounded-[26px] border border-border-subtle bg-grouped-card px-4 pt-4 pb-5"
      >
        <View className="w-full flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-1.5 rounded-full border border-adaptive-fuchsia-500-a50-300-a40 bg-fuchsia-500/12 px-2.5 py-1">
            <SymbolView
              name="person.2"
              size={12}
              tintColorClassName="accent-adaptive-fuchsia-600-300"
              type="monochrome"
            />
            <Text className="text-2xs font-t3-bold text-adaptive-fuchsia-600-300">
              <T>Guest pass</T>
            </Text>
          </View>
          <View className="flex-row items-center gap-1 rounded-full border border-border-subtle bg-subtle px-2.5 py-1">
            <SymbolView
              name="clock"
              size={11}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
            <Text
              className="font-mono text-2xs font-t3-medium text-foreground-muted"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {gt("{remaining} left", { remaining: countdown })}
            </Text>
          </View>
        </View>

        <View
          accessibilityRole="image"
          accessibilityLabel={gt("Guest pass QR code. Scan in person to join this thread.")}
          className="rounded-[20px] bg-white p-3.5 shadow-xs"
        >
          <Svg width={184} height={184} viewBox={`0 0 ${qr.viewBoxSize} ${qr.viewBoxSize}`}>
            <Rect width={qr.viewBoxSize} height={qr.viewBoxSize} fill="#ffffff" />
            <Path d={qr.modulesPath} fill="#111113" />
            <G>
              {qr.finderEyes.map((eye) => {
                const ox = eye.x + GUEST_QR_MARGIN;
                const oy = eye.y + GUEST_QR_MARGIN;
                return (
                  <G key={`${eye.x}:${eye.y}`}>
                    <Rect
                      x={ox + 0.5}
                      y={oy + 0.5}
                      width={6}
                      height={6}
                      rx={1.85}
                      fill="none"
                      stroke="#111113"
                      strokeWidth={1}
                    />
                    <Rect x={ox + 2} y={oy + 2} width={3} height={3} rx={0.95} fill="#111113" />
                  </G>
                );
              })}
            </G>
          </Svg>
        </View>

        <View className="w-full gap-1.5">
          <Text className="text-center text-xs font-t3-medium text-foreground">
            <T>Scan in person or share the one-time link</T>
          </Text>
          <Text className="text-center text-xs text-foreground-muted">
            <T>Read-only view · You approve each guest message before it sends.</T>
          </Text>
        </View>
      </View>

      <View className="gap-2">
        <View className="rounded-2xl border border-input-border bg-input px-3.5 py-3">
          <Text selectable numberOfLines={3} className="font-mono text-xs text-foreground">
            {props.url}
          </Text>
        </View>
        <Text className="px-1 text-xs text-foreground-muted">
          <T>Send it to one person. It works once and expires in 24 hours.</T>
        </Text>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label={props.copied ? gt("Copied") : gt("Copy")}
            icon={props.copied ? "checkmark" : "doc.on.doc"}
            fullWidth
            onPress={props.onCopy}
          />
        </View>
        <View className="flex-1">
          <Button
            label={gt("Share")}
            icon="square.and.arrow.up"
            tone="primary"
            fullWidth
            onPress={props.onShare}
          />
        </View>
      </View>
    </Animated.View>
  );
}

type CreateState =
  | { readonly status: "idle" }
  | { readonly status: "creating" }
  | { readonly status: "created"; readonly url: string; readonly share: ThreadGuestShare }
  | { readonly status: "failed"; readonly message: string };

type GuestShareTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export function ThreadGuestShareSheet({ route }: StaticScreenProps<GuestShareTarget>) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environmentId, threadId } = route.params;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const guestShare = useThreadGuestShare(threadRef);
  const shareExpired = useDeadlinePassed(
    guestShare === null ? null : Date.parse(guestShare.expiresAt),
  );
  const activeShare = shareExpired ? null : guestShare;
  const hasPendingMessages =
    guestShare?.messages.some((message) => message.status === "pending") ?? false;
  // From the thread list the detail loads only now; until it does, an active link is unknown and a
  // new link would end it without the warning.
  const thread = useAtomValue(environmentThreadDetails.threadAtom(threadRef));
  const threadLoaded = thread !== null;
  const threadDeleted = useAtomValue(
    environmentThreadDetails.statusAtom(threadRef),
    (status) => status === "deleted",
  );
  const threadLoadError = useAtomValue(environmentThreadDetails.errorAtom(threadRef));
  const canCreate = useAtomValue(serverEnvironment.createGuestShare.permissionAtom(environmentId));
  const createGuestShare = useAtomCommand(serverEnvironment.createGuestShare, {
    reportFailure: false,
  });
  const [state, setState] = useState<CreateState>({ status: "idle" });
  const [copiedAtMs, setCopiedAtMs] = useState<number | null>(null);
  const copyFeedbackEnded = useDeadlinePassed(
    copiedAtMs === null ? null : copiedAtMs + COPY_FEEDBACK_DURATION_MS,
  );
  const copied = copiedAtMs !== null && !copyFeedbackEnded;
  const creating = state.status === "creating";
  const close = () => navigation.goBack();
  // The link is shown only once, so any dismiss mid-request (swipe, header, Android back) would lose it.
  usePreventRemove(creating, () => {});

  const create = async () => {
    if (hasPendingMessages) {
      Dialog.alert(gt("Guest messages are waiting"), m(PENDING_MESSAGES_NOTICE));
      return;
    }
    setState({ status: "creating" });
    const result = await createGuestShare({ environmentId, input: { threadId } });
    if (result._tag === "Success") {
      triggerSemanticHaptic("confirm");
      setState({ status: "created", url: result.value.url, share: result.value.share });
      return;
    }
    if (isAtomCommandInterrupted(result)) {
      setState({ status: "idle" });
      return;
    }
    triggerSemanticHaptic("reject");
    const error = squashAtomCommandFailure(result);
    setState({
      status: "failed",
      message: error instanceof Error ? error.message : gt("Could not create a guest link."),
    });
  };

  const copy = async (url: string) => {
    if (!(await tryCopyTextWithHaptic(url, { target: "guest link" }))) {
      triggerSemanticHaptic("reject");
      Dialog.alert(gt("Could not copy"), gt("Try again."));
      return;
    }
    triggerSemanticHaptic("confirm");
    setCopiedAtMs(Date.now());
  };

  const share = (url: string) => {
    // Android ignores `url`; iOS turns a `message` URL into plain text instead of a link preview.
    Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch((cause: unknown) => {
      console.error("Failed to share guest link.", cause);
      Dialog.alert(gt("Could not share the link"), gt("Copy it instead."));
    });
  };

  const createdShareExpired = useDeadlinePassed(
    state.status === "created" ? Date.parse(state.share.expiresAt) : null,
  );
  const createdLink =
    state.status === "created" &&
    !createdShareExpired &&
    !threadDeleted &&
    (thread === null ||
      DateTime.toEpochMillis(thread.projection.thread.updatedAt) <
        Date.parse(state.share.createdAt) ||
      (activeShare?.id === state.share.id && activeShare.guestName === null))
      ? state
      : null;

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="gap-5 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {createdLink !== null ? (
        <GuestPassQrCard
          url={createdLink.url}
          expiresAt={createdLink.share.expiresAt}
          copied={copied}
          onCopy={() => void copy(createdLink.url)}
          onShare={() => share(createdLink.url)}
        />
      ) : (
        <>
          <View className="flex-row gap-3">
            <View className="size-10 items-center justify-center rounded-full border border-border bg-card">
              <SymbolView
                name="person.badge.plus"
                size={18}
                tintColorClassName="accent-foreground"
              />
            </View>
            <Text className="min-w-0 flex-1 text-sm leading-normal text-foreground-secondary">
              <T>
                The guest sees the thread as you do, including command output and the agent's
                reasoning. Each message they send waits for you.
              </T>
            </Text>
          </View>
          <View className="gap-1.5">
            {!threadLoaded ? (
              <Text className="text-sm text-foreground-muted">
                {threadDeleted
                  ? gt("This thread was deleted.")
                  : (threadLoadError ?? gt("Checking for an active link…"))}
              </Text>
            ) : activeShare !== null ? (
              <Text className="text-sm text-foreground">
                {activeShare.guestName !== null
                  ? gt("{name} is a guest. A new link ends their access.", {
                      name: activeShare.guestName,
                    })
                  : gt("A guest link is active. A new link ends the current one.")}
              </Text>
            ) : (
              <Text className="text-sm text-foreground">
                <T>The link works once and expires in 24 hours.</T>
              </Text>
            )}
            {hasPendingMessages ? (
              <Text className="text-sm text-foreground-muted">{m(PENDING_MESSAGES_NOTICE)}</Text>
            ) : null}
            {state.status === "failed" ? (
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {state.message}
              </Text>
            ) : null}
          </View>
          <Button
            label={
              creating
                ? gt("Creating link…")
                : state.status === "failed"
                  ? gt("Try again")
                  : activeShare !== null
                    ? gt("Create new link")
                    : gt("Create link")
            }
            tone="primary"
            fullWidth
            loading={creating}
            disabled={!canCreate || !threadLoaded || hasPendingMessages}
            onPress={() => void create()}
          />
        </>
      )}
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader
          presentation="native"
          title={m(TITLE)}
          onClose={close}
          dismissDisabled={creating}
        />
        {content}
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-header">
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AppBar sheet title={m(TITLE)} hideBottomBorder onBack={close} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}
