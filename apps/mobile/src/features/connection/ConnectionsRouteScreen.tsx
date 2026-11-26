import { T, useGT } from "gt-react-native";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";

import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Fragment, useEffect, useState } from "react";
import { Animated as RNAnimated, useAnimatedValue, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { startNativePulseLoop } from "../../lib/mobileMotion";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { usePreparedConnection } from "../../state/session";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { LocalEnvironmentList } from "./LocalEnvironmentList";
import { PullRequestRoutingSettings } from "./PullRequestRoutingSettings";
import { LinkedEnvironmentsSection } from "./LinkedEnvironmentsSection";
import { LinkSeveralEnvironmentsAction } from "./LinkSeveralEnvironments";

const LATENCY_PROBE_INTERVAL_MS = 15_000;
const LATENCY_PROBE_TIMEOUT_MS = 4_000;

function formatLatencyTone(latencyMs: number | null): string {
  if (latencyMs === null)
    return "border-adaptive-emerald-600-400/25 bg-adaptive-emerald-600-400/10 text-adaptive-emerald-700-300";
  if (latencyMs <= 80) {
    return "border-adaptive-emerald-600-400/30 bg-adaptive-emerald-600-400/12 text-adaptive-emerald-700-300";
  }
  if (latencyMs <= 240) {
    return "border-warning-foreground/30 bg-warning-foreground/12 text-warning-foreground";
  }
  return "border-danger-foreground/30 bg-danger-foreground/12 text-danger-foreground";
}

function LiveOnlinePulseDot(props: { readonly active: boolean }) {
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives continuous online breathing dot via RN Animated native driver (obeys DISABLE_COMMIT_PAUSING_MECHANISM)
  useEffect(
    () => startNativePulseLoop(pulse, { active: props.active, duration: 1800, mode: "expand" }),
    [props.active, pulse],
  );

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View className="size-4 items-center justify-center">
      {props.active ? (
        <RNAnimated.View
          pointerEvents="none"
          className="absolute size-2.5 rounded-full bg-adaptive-emerald-600-400"
          style={{ opacity: haloOpacity, transform: [{ scale: haloScale }] }}
        />
      ) : null}
      <View className="size-2 rounded-full bg-adaptive-emerald-600-400" />
    </View>
  );
}

function LiveEnvironmentTelemetryChip(props: {
  readonly environment: ConnectedEnvironmentSummary;
  readonly telemetryActive: boolean;
  readonly pulseActive: boolean;
}) {
  const gt = useGT();
  const prepared = usePreparedConnection(props.environment.environmentId);
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures read-only round-trip latency against the existing /api/auth/session endpoint while the screen is focused
  useEffect(() => {
    if (!props.telemetryActive || !httpBaseUrl) {
      return;
    }
    let disposed = false;
    let activeController: AbortController | null = null;
    let activeTimeout: ReturnType<typeof setTimeout> | null = null;

    const measure = async () => {
      activeController?.abort();
      if (activeTimeout !== null) clearTimeout(activeTimeout);
      const controller = new AbortController();
      activeController = controller;
      activeTimeout = setTimeout(() => controller.abort(), LATENCY_PROBE_TIMEOUT_MS);
      const startedAt = performance.now();
      try {
        const probeUrl = new URL("/api/auth/session", httpBaseUrl).toString();
        await fetch(probeUrl, { method: "GET", signal: controller.signal });
        if (!disposed) {
          setLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
        }
      } catch {
        // Keep last valid sample or fall back to "Online" when offline/aborted.
      } finally {
        if (activeTimeout !== null) {
          clearTimeout(activeTimeout);
          activeTimeout = null;
        }
      }
    };

    void measure();
    const interval = setInterval(() => {
      void measure();
    }, LATENCY_PROBE_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      if (activeTimeout !== null) clearTimeout(activeTimeout);
      activeController?.abort();
    };
  }, [httpBaseUrl, props.telemetryActive]);

  return (
    <View
      collapsable={false}
      className="flex-row items-center gap-2 rounded-full border border-border-subtle bg-grouped-card px-3 py-1.5"
    >
      <LiveOnlinePulseDot active={props.pulseActive} />
      <Text className="max-w-[140px] text-xs font-t3-medium text-foreground" numberOfLines={1}>
        {props.environment.environmentLabel}
      </Text>
      <View className={cn("rounded-full border px-2 py-0.5", formatLatencyTone(latencyMs))}>
        <Text
          className="font-mono text-2xs font-t3-medium"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {latencyMs !== null
            ? gt("{ms} ms", { ms: latencyMs })
            : props.environment.isRelayManaged
              ? gt("Relay")
              : gt("Online")}
        </Text>
      </View>
    </View>
  );
}

export function ConnectionsRouteScreen() {
  const gt = useGT();
  const {
    connectedEnvironments,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onSetEnvironmentEnabled,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const [expandedId, setExpandedId] = useState<EnvironmentId | null>(null);
  const handleToggle = (environmentId: EnvironmentId) => {
    setExpandedId((prev) => (prev === environmentId ? null : environmentId));
  };
  const onlineEnvironments = connectedEnvironments.filter(
    (environment) => environment.connectionState === "connected",
  );
  const telemetryActive = appActive && isFocused;
  const pulseActive = telemetryActive && !reducedMotion;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar
        title={gt("Environments")}
        onClose={() => navigation.goBack()}
        closeAccessibilityLabel={gt("Close environments")}
        actions={[
          {
            accessibilityLabel: gt("Add environment"),
            icon: "plus",
            onPress: () => navigation.navigate("ConnectionsNew"),
          },
        ]}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        {onlineEnvironments.length > 0 ? (
          <View collapsable={false} className="mb-3 gap-1.5">
            <Text className="px-1 text-xs font-t3-medium text-foreground-muted">
              <T>Live connections</T>
            </Text>
            <View collapsable={false} className="flex-row flex-wrap gap-2">
              {onlineEnvironments.map((environment) => (
                <LiveEnvironmentTelemetryChip
                  key={environment.environmentId}
                  environment={environment}
                  telemetryActive={telemetryActive}
                  pulseActive={pulseActive}
                />
              ))}
            </View>
          </View>
        ) : null}
        <LocalEnvironmentList
          environments={connectedEnvironments}
          expandedId={expandedId}
          onToggle={handleToggle}
          onReconnect={onReconnectEnvironment}
          onRemove={onRemoveEnvironmentPress}
          onSetEnabled={onSetEnvironmentEnabled}
          onUpdate={onUpdateEnvironment}
        />
        {onlineEnvironments.map((environment) => (
          <Fragment key={environment.environmentId}>
            <LinkedEnvironmentsSection
              environmentId={environment.environmentId}
              environmentLabel={environment.environmentLabel}
            />
            <LinkSeveralEnvironmentsAction
              environmentId={environment.environmentId}
              environmentLabel={environment.environmentLabel}
            />
          </Fragment>
        ))}
        <PullRequestRoutingSettings />
      </ScrollView>
    </View>
  );
}
