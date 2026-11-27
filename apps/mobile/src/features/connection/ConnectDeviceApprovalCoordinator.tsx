import { msg, T, useGT } from "gt-react-native";
import { unseenConnectDevices } from "@t3tools/client-runtime/connect-device-notices";
import {
  AuthAccessWriteScope,
  type AuthClientMetadata,
  type AuthConnectDevice,
  type AuthPairingLink,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Fragment, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { Animated as RNAnimated, Platform, StyleSheet, useAnimatedValue, View } from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { OverlayPortal } from "../../components/ui/OverlayPortal";
import { m } from "../../i18n/messages";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import {
  SPRING_SPATIAL_SNAPPY,
  startNativePulseLoop,
  TIMING_QUICK_FADE,
} from "../../lib/mobileMotion";
import { loadPreferences, updatePreferences } from "../../persistence/imperative";
import { authEnvironment } from "../../state/auth";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type ConnectDeviceApprovalPrompt,
  connectDeviceApprovalPrompts,
  createApprovalPromptQueue,
  describeConnectDevice,
} from "./connectDeviceApproval";

const APPROVAL_ARM_DELAY_MS = 700;
const APPROVAL_URGENT_MS = 30_000;
const APPROVAL_STAMP_HOLD_MS = 520;

/**
 * Formats a verification code into readable fixed-width groups (e.g. `842917` -> `842 · 917`,
 * `ABCD-EFGH` -> `ABCD · EFGH`) while preserving every character verbatim.
 */
export function formatVerificationCodeGroups(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return "";
  if (trimmed.includes("-")) {
    return trimmed
      .split("-")
      .filter((part) => part.length > 0)
      .join(" · ");
  }
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)} · ${trimmed.slice(3)}`;
  }
  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)} · ${trimmed.slice(4)}`;
  }
  return trimmed;
}

/**
 * Asks to approve T3 Connect devices waiting on hosts that require it and this phone manages,
 * and tells it about devices that got in on hosts that do not.
 */
export function ConnectDeviceApprovalCoordinator() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== undefined,
  );
  const managed = useEnvironmentsWithScope(connected, AuthAccessWriteScope);
  return (
    <>
      {connected
        .filter((environment) => managed.has(environment.environmentId))
        .map((environment) => {
          const approvalRequired =
            environment.serverConfig?.settings.requireConnectDeviceApproval === true;
          return (
            <Fragment key={environment.environmentId}>
              {approvalRequired ? (
                <EnvironmentApprovalWatcher
                  environmentId={environment.environmentId}
                  environmentLabel={environment.label}
                />
              ) : null}
              <NewConnectDeviceWatcher
                environmentId={environment.environmentId}
                environmentLabel={environment.label}
                announce={!approvalRequired}
              />
            </Fragment>
          );
        })}
      <ApprovalHandshakeSheetHost />
    </>
  );
}

interface NewDeviceNotice {
  readonly kind: "notice";
  /** Keys the shared dialog queue; a later notice for the same host carries a newer watermark. */
  readonly pairingLinkId: string;
  readonly environmentId: EnvironmentId;
}

/** "gone": the request expired or was answered elsewhere before this answer arrived. */
export type ApprovalAnswer = "done" | "failed" | "gone";

export interface QueuedApprovalPrompt extends ConnectDeviceApprovalPrompt {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly deviceLabel: string;
  readonly deviceType: AuthClientMetadata["deviceType"] | undefined;
  readonly verificationCode: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly approve: () => Promise<ApprovalAnswer>;
  readonly deny: () => Promise<ApprovalAnswer>;
}

interface QueuedApprovalDialogItem {
  readonly kind: "approval";
  /** Keys the shared queue with a prefix so approvals never collide with notices. */
  readonly pairingLinkId: string;
  readonly rawPairingLinkId: string;
  readonly environmentId: EnvironmentId;
  readonly prompt: QueuedApprovalPrompt;
}

type QueuedConnectDialog = NewDeviceNotice | QueuedApprovalDialogItem;

interface ActiveApprovalSheetEntry {
  readonly presentationId: number;
  readonly prompt: QueuedApprovalPrompt;
  readonly answer: (outcome: "done" | "retry" | "later") => void;
  /** Locks out remote-drop auto-dismiss while a user decision or confirmation stamp is in flight. */
  readonly lockDecision: () => void;
  /** Unlocks after a retryable failure; returns true if the link was withdrawn while in flight. */
  readonly unlockDecision: () => boolean;
}

const APPROVAL_QUEUE_KEY_PREFIX = "approval:";

/** The latest device list per watched host, read when a notice shows so it names only unseen devices. */
const announcedHosts = new Map<
  EnvironmentId,
  { readonly label: string; readonly devices: ReadonlyArray<AuthConnectDevice> }
>();

const watchedEnvironments = new Set<EnvironmentId>();
let activeApprovalSheet: ActiveApprovalSheetEntry | null = null;
let nextPresentationId = 0;
const approvalSheetListeners = new Set<() => void>();

function emitApprovalSheetChange() {
  for (const listener of approvalSheetListeners) {
    listener();
  }
}

function setActiveApprovalSheet(next: ActiveApprovalSheetEntry | null) {
  activeApprovalSheet = next;
  emitApprovalSheetChange();
}

function subscribeApprovalSheet(listener: () => void) {
  approvalSheetListeners.add(listener);
  return () => {
    approvalSheetListeners.delete(listener);
  };
}

function getActiveApprovalSheet(): ActiveApprovalSheetEntry | null {
  return activeApprovalSheet;
}

const loadSeenThrough = async (environmentId: EnvironmentId) => {
  const preferences = await loadPreferences().catch(() => null);
  return preferences === null
    ? null
    : { seenThrough: preferences.connectDevicesSeenThrough?.[environmentId] };
};

const markConnectDevicesSeen = (environmentId: EnvironmentId, newest: number) =>
  updatePreferences((current) => ({
    connectDevicesSeenThrough: {
      ...current.connectDevicesSeenThrough,
      [environmentId]: Math.max(current.connectDevicesSeenThrough?.[environmentId] ?? 0, newest),
    },
  })).catch(() => undefined);

// One shared queue for approvals and new-device notices across all hosts: on Android a second
// dialog replaces or overlaps the one on screen, so notices and Material 3 Verification Handshake
// sheets serialize cleanly while preserving the exact queue, retry, and drop semantics.
const connectDeviceDialogQueue = createApprovalPromptQueue<QueuedConnectDialog>((item, answer) => {
  if (item.kind === "notice") {
    void (async () => {
      const host = announcedHosts.get(item.environmentId);
      const seen = host ? await loadSeenThrough(item.environmentId) : null;
      const current = announcedHosts.get(item.environmentId);
      if (!current || seen === null || seen.seenThrough === undefined) return answer("done");
      const { unseen, newest } = unseenConnectDevices(current.devices, seen.seenThrough);
      if (unseen.length === 0) return answer("done");
      const [firstDevice = ""] = unseen.map(({ client: device }) => describeConnectDevice(device));
      Dialog.alert(
        m(msg("New device signed in to {environment}", { environment: current.label })),
        unseen.length === 1
          ? m(
              msg(
                "{device} connected through {product}. If this was not you, remove it in Settings → Access in T3 Code on that computer.",
                { device: firstDevice, product: "T3 Connect" },
              ),
            )
          : m(
              msg(
                "{count, plural, one {{count} device} other {{count} devices}} connected through {product}. If this was not you, remove them in Settings → Access in T3 Code on that computer.",
                { count: unseen.length, product: "T3 Connect" },
              ),
            ),
        [
          {
            text: m(msg("OK")),
            onPress: () => {
              void markConnectDevicesSeen(item.environmentId, newest).then(() => answer("done"));
            },
          },
        ],
        // Another dialog took the screen; the notice shows again on the next update.
        { onDismiss: () => answer("later") },
      );
    })();
    return;
  }

  const presentationId = ++nextPresentationId;
  let decisionInFlight = false;
  let dropped = false;
  const finish = (outcome: "done" | "retry" | "later") => {
    if (activeApprovalSheet?.presentationId === presentationId) {
      setActiveApprovalSheet(null);
    }
    answer(outcome);
  };
  setActiveApprovalSheet({
    presentationId,
    prompt: item.prompt,
    answer: finish,
    lockDecision: () => {
      decisionInFlight = true;
    },
    unlockDecision: () => {
      decisionInFlight = false;
      return dropped;
    },
  });
  return () => {
    dropped = true;
    if (!decisionInFlight) {
      finish("done");
    }
  };
});

/** Exposed solely for deterministic unit tests of the approval handshake presentation bridge. */
export function getActiveApprovalHandshakeForTesting(): ActiveApprovalSheetEntry | null {
  return activeApprovalSheet;
}

export function offerApprovalPromptsForTesting(
  environmentId: EnvironmentId,
  prompts: ReadonlyArray<QueuedApprovalPrompt>,
): () => void {
  watchedEnvironments.add(environmentId);
  connectDeviceDialogQueue.offer(
    prompts.map((prompt) => ({
      kind: "approval" as const,
      pairingLinkId: `${APPROVAL_QUEUE_KEY_PREFIX}${prompt.pairingLinkId}`,
      rawPairingLinkId: prompt.pairingLinkId,
      environmentId: prompt.environmentId,
      prompt,
    })),
  );
  return () => {
    watchedEnvironments.delete(environmentId);
    connectDeviceDialogQueue.drop(
      (item) => item.kind === "approval" && item.environmentId === environmentId,
    );
    if (activeApprovalSheet?.prompt.environmentId === environmentId) {
      activeApprovalSheet.answer("done");
    }
  };
}

/** Devices approved by hand are already known, so only `announce` hosts that skip approval. */
function NewConnectDeviceWatcher(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly announce: boolean;
}) {
  const access = useEnvironmentQuery(
    authEnvironment.accessChanges({ environmentId: props.environmentId, input: null }),
  );
  // Older servers omit the list.
  const devices = access.data?.type === "snapshot" ? access.data.payload.connectDevices : undefined;

  const check = useEffectEvent(async (current: ReadonlyArray<AuthConnectDevice>) => {
    announcedHosts.set(props.environmentId, { label: props.environmentLabel, devices: current });
    const seen = await loadSeenThrough(props.environmentId);
    // The host went away while preferences loaded.
    if (seen === null || announcedHosts.get(props.environmentId)?.devices !== current) return;
    const { unseen, newest } = unseenConnectDevices(current, seen.seenThrough);
    if (!props.announce || unseen.length === 0) {
      if (seen.seenThrough !== newest) await markConnectDevicesSeen(props.environmentId, newest);
      return;
    }
    connectDeviceDialogQueue.offer([
      {
        kind: "notice",
        pairingLinkId: `notice:${props.environmentId}:${newest}`,
        environmentId: props.environmentId,
      },
    ]);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a device this phone has not announced opens a native alert
  useEffect(() => {
    if (devices !== undefined) void check(devices);
  }, [devices]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forgets this host and drops its queued notice when it goes away
  useEffect(() => {
    const environmentId = props.environmentId;
    return () => {
      announcedHosts.delete(environmentId);
      connectDeviceDialogQueue.drop(
        (item) => item.kind === "notice" && item.environmentId === environmentId,
      );
    };
  }, [props.environmentId]);

  return null;
}

function EnvironmentApprovalWatcher(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const access = useEnvironmentQuery(
    authEnvironment.accessChanges({ environmentId: props.environmentId, input: null }),
  );
  const approve = useAtomCommand(authEnvironment.approveConnectDevice, { reportFailure: false });
  const deny = useAtomCommand(authEnvironment.revokePairingLink, { reportFailure: false });
  const pairingLinks =
    access.data?.type === "snapshot" ? access.data.payload.pairingLinks : undefined;

  const offerPrompts = useEffectEvent((links: ReadonlyArray<AuthPairingLink>) => {
    const activeIds = new Set(
      links.flatMap((link) => (link.connectDeviceRequest !== undefined ? [link.id] : [])),
    );
    connectDeviceDialogQueue.drop(
      (item) =>
        item.kind === "approval" &&
        item.environmentId === props.environmentId &&
        !activeIds.has(item.rawPairingLinkId),
    );
    const knownApprovalIds = new Set<string>();
    for (const key of connectDeviceDialogQueue.known) {
      if (key.startsWith(APPROVAL_QUEUE_KEY_PREFIX)) {
        knownApprovalIds.add(key.slice(APPROVAL_QUEUE_KEY_PREFIX.length));
      }
    }
    const linksById = new Map(links.map((link) => [link.id, link]));
    const prompts = connectDeviceApprovalPrompts({
      environmentLabel: props.environmentLabel,
      pairingLinks: links,
      shownIds: knownApprovalIds,
    });
    connectDeviceDialogQueue.offer(
      prompts.map((prompt) => {
        const link = linksById.get(prompt.pairingLinkId);
        const request = link?.connectDeviceRequest;
        const device = request
          ? (({ client: metadata }: NonNullable<AuthPairingLink["connectDeviceRequest"]>) =>
              metadata)(request)
          : undefined;
        const createdAtMs = link ? DateTime.toEpochMillis(link.createdAt) : Date.now();
        const expiresAtMs = link
          ? DateTime.toEpochMillis(link.expiresAt)
          : createdAtMs + 10 * 60_000;
        const queuedPrompt: QueuedApprovalPrompt = {
          ...prompt,
          environmentId: props.environmentId,
          environmentLabel: props.environmentLabel,
          deviceLabel: describeConnectDevice(device),
          deviceType: device?.deviceType,
          verificationCode: request?.verificationCode ?? "",
          createdAtMs,
          expiresAtMs,
          approve: () =>
            approve({
              environmentId: props.environmentId,
              input: { pairingLinkId: prompt.pairingLinkId },
            }).then((result) =>
              result._tag !== "Success" ? "failed" : result.value.approved ? "done" : "gone",
            ),
          deny: () =>
            deny({ environmentId: props.environmentId, input: { id: prompt.pairingLinkId } }).then(
              (result) =>
                result._tag !== "Success" ? "failed" : result.value.revoked ? "done" : "gone",
            ),
        };
        return {
          kind: "approval" as const,
          pairingLinkId: `${APPROVAL_QUEUE_KEY_PREFIX}${prompt.pairingLinkId}`,
          rawPairingLinkId: prompt.pairingLinkId,
          environmentId: props.environmentId,
          prompt: queuedPrompt,
        };
      }),
    );
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this host with the module-level prompt queue and drops its prompts when it goes away
  useEffect(() => {
    const environmentId = props.environmentId;
    watchedEnvironments.add(environmentId);
    return () => {
      watchedEnvironments.delete(environmentId);
      connectDeviceDialogQueue.drop(
        (item) => item.kind === "approval" && item.environmentId === environmentId,
      );
      if (activeApprovalSheet?.prompt.environmentId === environmentId) {
        activeApprovalSheet.answer("done");
      }
    };
  }, [props.environmentId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new request on the access stream enqueues a verification handshake prompt
  useEffect(() => {
    if (pairingLinks !== undefined) offerPrompts(pairingLinks);
  }, [pairingLinks]);

  return null;
}

function ApprovalHandshakeSheetHost() {
  const active = useSyncExternalStore(
    subscribeApprovalSheet,
    getActiveApprovalSheet,
    getActiveApprovalSheet,
  );
  if (active === null) return null;

  return (
    <OverlayPortal>
      <ApprovalHandshakeCard key={active.presentationId} entry={active} />
    </OverlayPortal>
  );
}

function HandshakeDotBridge(props: { readonly active: boolean }) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const shouldPulse = props.active && appActive && !reducedMotion;
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs continuous signal bridge animation on RN Animated native driver (obeys DISABLE_COMMIT_PAUSING_MECHANISM)
  useEffect(
    () => startNativePulseLoop(pulse, { active: shouldPulse, duration: 1400, mode: "breathe" }),
    [pulse, shouldPulse],
  );

  const dot0Opacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.35] });
  const dot1Opacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.65, 0.35, 1] });
  const dot2Opacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.45, 0.3] });

  return (
    <View className="flex-row items-center gap-1.5 px-2">
      <RNAnimated.View
        className="size-1.5 rounded-full bg-primary"
        style={{ opacity: shouldPulse ? dot0Opacity : 0.7 }}
      />
      <RNAnimated.View
        className="size-2 rounded-full bg-primary"
        style={{ opacity: shouldPulse ? dot1Opacity : 0.9 }}
      />
      <RNAnimated.View
        className="size-1.5 rounded-full bg-primary"
        style={{ opacity: shouldPulse ? dot2Opacity : 0.7 }}
      />
    </View>
  );
}

type HandshakeCardPhase =
  | { readonly kind: "waiting" }
  | { readonly kind: "submitting"; readonly action: "approve" | "deny" }
  | { readonly kind: "stamped"; readonly action: "approve" | "deny" }
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly title: string };

function ApprovalHandshakeCard({ entry }: { readonly entry: ActiveApprovalSheetEntry }) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { prompt, answer } = entry;
  const [phase, setPhase] = useState<HandshakeCardPhase>({ kind: "waiting" });
  const [armed, setArmed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const stampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sheetProgress = useSharedValue(0);
  const armSweep = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears any pending confirmation stamp timer if the card unmounts early
  useEffect(
    () => () => {
      if (stampTimerRef.current !== null) {
        clearTimeout(stampTimerRef.current);
        stampTimerRef.current = null;
      }
    },
    [],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- springs the Material 3 Verification Handshake sheet into view and runs the 700ms anti-accidental-tap arming sweep
  useEffect(() => {
    sheetProgress.set(withSpring(1, SPRING_SPATIAL_SNAPPY));
    armSweep.set(0);
    armSweep.set(
      withTiming(1, {
        duration: APPROVAL_ARM_DELAY_MS,
        reduceMotion: TIMING_QUICK_FADE.reduceMotion,
      }),
    );
    const timer = setTimeout(() => setArmed(true), APPROVAL_ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [armSweep, sheetProgress]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks once per second to update the verification code expiry bar and countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- auto-dismisses an expired waiting prompt so queued approvals and notices are never stalled
  useEffect(() => {
    if (phase.kind !== "waiting" && phase.kind !== "failed") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const remaining = prompt.expiresAtMs - Date.now();
      if (remaining <= 0) {
        answer("done");
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [answer, phase.kind, prompt.expiresAtMs]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: sheetProgress.get() * 0.52,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: sheetProgress.get(),
    transform: [{ translateY: (1 - sheetProgress.get()) * 32 }],
  }));

  const armFillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: armSweep.get() }],
    opacity: armed ? 0 : 0.24,
  }));

  const totalLifetimeMs = Math.max(1_000, prompt.expiresAtMs - prompt.createdAtMs);
  const remainingMs = Math.max(0, prompt.expiresAtMs - nowMs);
  const expiryFraction = Math.max(0, Math.min(1, remainingMs / totalLifetimeMs));
  const isUrgent = remainingMs > 0 && remainingMs <= APPROVAL_URGENT_MS;
  const isExpired = remainingMs === 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const formattedCode = formatVerificationCodeGroups(prompt.verificationCode);

  const runDecision = async (action: "approve" | "deny") => {
    if (phase.kind !== "waiting") return;
    if (action === "approve" && !armed) return;
    if (Date.now() >= prompt.expiresAtMs) {
      answer("done");
      return;
    }
    entry.lockDecision();
    setPhase({ kind: "submitting", action });
    const outcome = await (action === "approve" ? prompt.approve() : prompt.deny());
    if (outcome === "done" || !watchedEnvironments.has(prompt.environmentId)) {
      triggerSemanticHaptic(action === "approve" ? "confirm" : "reject");
      setPhase({ kind: "stamped", action });
      stampTimerRef.current = setTimeout(() => {
        stampTimerRef.current = null;
        answer("done");
      }, APPROVAL_STAMP_HOLD_MS);
      return;
    }
    if (outcome === "gone") {
      triggerSemanticHaptic("reject");
      setPhase({ kind: "gone" });
      return;
    }
    const wasDropped = entry.unlockDecision();
    if (wasDropped || Date.now() >= prompt.expiresAtMs) {
      triggerSemanticHaptic("reject");
      setPhase({ kind: "gone" });
      return;
    }
    triggerSemanticHaptic("reject");
    setPhase({
      kind: "failed",
      title:
        action === "approve" ? gt("Could not approve the device") : gt("Could not deny the device"),
    });
  };

  const deviceSymbol =
    prompt.deviceType === "mobile"
      ? "iphone"
      : prompt.deviceType === "desktop"
        ? "desktopcomputer"
        : "laptopcomputer";

  return (
    <View
      collapsable={false}
      style={StyleSheet.absoluteFill}
      className="justify-end"
      accessibilityViewIsModal
    >
      <Reanimated.View
        pointerEvents="auto"
        style={[StyleSheet.absoluteFill, styles.scrim, backdropStyle]}
      />
      <Reanimated.View
        collapsable={false}
        style={[
          cardStyle,
          {
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          },
        ]}
        className={cn(
          "mx-3 mb-3 rounded-[28px] border border-border bg-sheet px-5 pt-5",
          Platform.OS === "android" ? "shadow-lg" : "shadow-md",
        )}
      >
        {/* Material 3 Tonal Device Bridge Header */}
        <View className="flex-row items-center justify-between rounded-[20px] border border-border-subtle bg-grouped-card px-3.5 py-3">
          <View className="min-w-0 flex-1 items-center gap-1">
            <View className="size-9 items-center justify-center rounded-2xl bg-subtle">
              <SymbolView
                name="desktopcomputer"
                size={18}
                tintColorClassName="accent-foreground"
                type="monochrome"
              />
            </View>
            <Text className="text-center text-xs font-t3-medium text-foreground" numberOfLines={1}>
              {prompt.environmentLabel}
            </Text>
          </View>

          <HandshakeDotBridge active={phase.kind === "waiting" || phase.kind === "submitting"} />

          <View className="min-w-0 flex-1 items-center gap-1">
            <View className="size-9 items-center justify-center rounded-2xl bg-subtle">
              <SymbolView
                name={deviceSymbol}
                size={18}
                tintColorClassName="accent-foreground"
                type="monochrome"
              />
            </View>
            <Text className="text-center text-xs font-t3-medium text-foreground" numberOfLines={1}>
              {prompt.deviceLabel}
            </Text>
          </View>
        </View>

        <View className="mt-4 gap-1">
          <Text className="text-center text-lg font-t3-bold text-foreground">{prompt.title}</Text>
          <Text className="text-center text-xs leading-normal text-foreground-muted">
            {gt("Approve only if {device} displays this exact verification code.", {
              device: prompt.deviceLabel,
            })}
          </Text>
        </View>

        {/* Large tabular-nums grouped verification code tile + live expiry bar */}
        {formattedCode ? (
          <View className="mt-4 overflow-hidden rounded-[20px] border border-border-subtle bg-grouped-card px-4 pt-3.5 pb-3">
            <Text
              selectable
              accessibilityLabel={gt("Verification code {code}", { code: prompt.verificationCode })}
              className="text-center font-mono text-2xl font-t3-bold tracking-wider text-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formattedCode}
            </Text>
            <View className="mt-3 flex-row items-center justify-between gap-2">
              <View className="h-1 flex-1 overflow-hidden rounded-full bg-subtle">
                <View
                  className={cn(
                    "h-full rounded-full",
                    isExpired
                      ? "bg-danger-foreground"
                      : isUrgent
                        ? "bg-warning-foreground"
                        : "bg-primary",
                  )}
                  style={{
                    width: "100%",
                    transformOrigin: "left center",
                    transform: [{ scaleX: expiryFraction }],
                  }}
                />
              </View>
              <Text
                className={cn(
                  "font-mono text-2xs",
                  isUrgent || isExpired ? "text-warning-foreground" : "text-foreground-muted",
                )}
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {isExpired
                  ? gt("Expired")
                  : remainingSeconds < 60
                    ? gt("{seconds}s", { seconds: remainingSeconds })
                    : gt("{minutes}m", { minutes: Math.ceil(remainingSeconds / 60) })}
              </Text>
            </View>
          </View>
        ) : null}

        {phase.kind === "stamped" ? (
          <View
            accessibilityLiveRegion="polite"
            className={cn(
              "mt-4 flex-row items-center justify-center gap-2 rounded-2xl border px-4 py-3",
              phase.action === "approve"
                ? "border-adaptive-emerald-600-400/35 bg-adaptive-emerald-600-400/12"
                : "border-danger-foreground/35 bg-danger-foreground/10",
            )}
          >
            <SymbolView
              name={phase.action === "approve" ? "checkmark.circle.fill" : "xmark.circle.fill"}
              size={18}
              tintColorClassName={
                phase.action === "approve"
                  ? "accent-adaptive-emerald-600-400"
                  : "accent-danger-foreground"
              }
              type="monochrome"
            />
            <Text
              className={cn(
                "text-sm font-t3-bold",
                phase.action === "approve"
                  ? "text-adaptive-emerald-700-300"
                  : "text-danger-foreground",
              )}
            >
              {phase.action === "approve" ? <T>Device approved</T> : <T>Device denied</T>}
            </Text>
          </View>
        ) : phase.kind === "gone" ? (
          <View className="mt-4 gap-3">
            <Text className="text-center text-xs text-foreground-muted">
              <T>Request no longer waiting. It expired or was answered elsewhere.</T>
            </Text>
            <Button label={gt("OK")} tone="secondary" fullWidth onPress={() => answer("done")} />
          </View>
        ) : phase.kind === "failed" ? (
          <View className="mt-4 gap-3">
            <Text accessibilityRole="alert" className="text-center text-xs text-danger-foreground">
              {`${phase.title}. ${gt("The request is still waiting. Try again.")}`}
            </Text>
            <Button
              label={gt("Try again")}
              tone="primary"
              fullWidth
              onPress={() => {
                if (Date.now() >= prompt.expiresAtMs) {
                  answer("done");
                  return;
                }
                answer(watchedEnvironments.has(prompt.environmentId) ? "retry" : "done");
              }}
            />
          </View>
        ) : (
          <View className="mt-5 flex-row gap-2.5">
            <View className="flex-1">
              <Button
                label={
                  phase.kind === "submitting" && phase.action === "deny"
                    ? gt("Denying…")
                    : gt("Deny")
                }
                tone="danger"
                fullWidth
                disabled={phase.kind === "submitting" || isExpired}
                onPress={() => void runDecision("deny")}
              />
            </View>
            <View className="relative flex-1 overflow-hidden rounded-full">
              <Button
                label={
                  phase.kind === "submitting" && phase.action === "approve"
                    ? gt("Approving…")
                    : gt("Approve")
                }
                tone="primary"
                fullWidth
                loading={phase.kind === "submitting" && phase.action === "approve"}
                disabled={!armed || phase.kind === "submitting" || isExpired}
                onPress={() => void runDecision("approve")}
              />
              {!armed ? (
                <Reanimated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.armingSweep, armFillStyle]}
                />
              ) : null}
            </View>
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: "#000000",
  },
  armingSweep: {
    backgroundColor: "#ffffff",
    transformOrigin: "left center",
  },
});
