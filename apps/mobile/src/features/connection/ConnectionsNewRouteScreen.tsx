import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { T, useGT } from "gt-react-native";
import { ListRow } from "../../components/ui/ListRow";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAuth } from "@clerk/expo";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState, type ComponentRef, type Ref } from "react";
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useAnimatedValue,
  View,
} from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY, startNativePulseLoop } from "../../lib/mobileMotion";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { AppText as Text, AppTextInput, type AppTextInputProps } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { FrostedCutout } from "../../components/ui/FrostedCutout";
import type { FrostedCutoutLockRect } from "../../components/ui/FrostedCutout.types";
import { buildPairingUrl, extractPairingUrlFromQrPayload, parsePairingUrl } from "./pairing";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { SymbolView } from "../../components/ui/AppSymbol";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { CloudEnvironmentRows } from "./CloudEnvironmentRows";
import {
  autoConnectReport,
  devAutoConnectAttemptAtom,
  pairingLinksAllowed,
} from "./devAutoConnect";
import { linkedEnvironmentPrefillAtom } from "./linkedEnvironmentPrefill";
import { splitEnvironmentSections } from "./environmentSections";
import { leaveSettingsPage } from "../settings/settings-navigation";
import { workspaceHasColumns } from "../layout/workspace/workspace-selection-store";
import { m } from "../../i18n/messages";

export interface QrBarcodeScanPayload {
  readonly data: string;
  readonly bounds?: {
    readonly origin?: { readonly x: number; readonly y: number };
    readonly size?: { readonly width: number; readonly height: number };
  } | null;
  readonly cornerPoints?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/**
 * Extracts a positive-area bounding rectangle from CameraX / MLKit barcode scan output,
 * returning `null` when Android supplies empty bounds so the reticle performs a centered squeeze.
 */
export function extractBarcodeLockRect(result: QrBarcodeScanPayload): FrostedCutoutLockRect | null {
  const origin = result.bounds?.origin;
  const size = result.bounds?.size;
  if (
    origin &&
    size &&
    Number.isFinite(origin.x) &&
    Number.isFinite(origin.y) &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 12 &&
    size.height > 12
  ) {
    return {
      x: origin.x,
      y: origin.y,
      width: size.width,
      height: size.height,
    };
  }

  const points = result.cornerPoints;
  if (points && points.length >= 3) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 12 && height > 12) {
      return { x: minX, y: minY, width, height };
    }
  }

  return null;
}

type ConnectionsNewRouteParams = {
  readonly mode?: string;
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
  readonly routeFor?: EnvironmentId;
  /** A linked machine this app chose to pair with; its details come from app state, never the link. */
  readonly linked?: string;
};

export function ConnectionsNewRouteScreen({
  route,
}: StaticScreenProps<ConnectionsNewRouteParams | undefined>) {
  const params = route.params ?? {};
  // Store builds ignore the prefill so a link can never supply an attacker-chosen host and token.
  const routePairingUrl = pairingLinksAllowed() ? (params.pairingUrl?.trim() ?? "") : "";
  const known = useAtomValue(linkedEnvironmentPrefillAtom);
  const linked = known !== null && known.environmentId === params.linked ? known : null;
  // A new prefill link replaces whatever the form held.
  return (
    <PairingForm
      key={`${routePairingUrl}:${linked?.environmentId ?? ""}`}
      routePairingUrl={routePairingUrl}
      routeFor={params.routeFor ?? linked?.environmentId}
      linked={linked}
    />
  );
}

function PairingForm({
  routePairingUrl,
  routeFor,
  linked,
}: {
  readonly routePairingUrl: string;
  readonly routeFor: EnvironmentId | undefined;
  readonly linked: { readonly label: string; readonly host: string | null } | null;
}) {
  const gt = useGT();
  const { connectionPairingUrl, onChangeConnectionPairingUrl, onConnectPress } =
    useRemoteConnections();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [initialPairing] = useState(() => parsePairingUrl(routePairingUrl || connectionPairingUrl));
  const [hostInput, setHostInput] = useState(linked?.host ?? initialPairing.host);
  const [codeInput, setCodeInput] = useState(initialPairing.code);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The user's own edit or submit dismisses the dev auto-connect report.
  const [ownAttempt, setOwnAttempt] = useState(false);
  const autoConnect = autoConnectReport(
    useAtomValue(devAutoConnectAttemptAtom),
    routePairingUrl,
    ownAttempt,
  );
  const connecting = isSubmitting || autoConnect.connecting;
  const pairingConnectionError = submitError ?? autoConnect.error;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const screenFocused = useIsFocused();
  const [scannerLocked, setScannerLocked] = useState(false);
  // A good scan parks the camera so it can't re-read the code over later edits.
  const [scanComplete, setScanComplete] = useState(false);
  const [lockedRect, setLockedRect] = useState<FrostedCutoutLockRect | null>(null);
  const [scannedHost, setScannedHost] = useState<string | null>(null);
  const codeInputRef = useRef<ComponentRef<typeof AppTextInput>>(null);

  const headerIconColor = useUniwindTheme()["--color-icon"];

  const connectDisabled = connecting || hostInput.trim().length === 0;

  const clearError = () => {
    setSubmitError(null);
    setOwnAttempt(true);
  };

  const handleHostChange = (value: string) => {
    const pairing = parsePairingUrl(value);
    if (pairing.code) {
      setHostInput(pairing.host);
      setCodeInput(pairing.code);
    } else {
      setHostInput(value);
    }
    clearError();
  };

  const handleCodeChange = (value: string) => {
    setCodeInput(value);
    clearError();
  };

  const handleScanPress = async () => {
    const permission = await requestCameraPermission();
    if (permission.granted) {
      setScanComplete(false);
      setLockedRect(null);
      setScannedHost(null);
      clearError();
      return;
    }
    if (permission.canAskAgain) return;
    Dialog.alert(
      gt("Camera access needed"),
      gt("Camera access was denied for this app. Open Settings to enable it."),
      [
        { text: gt("Cancel"), style: "cancel" },
        { text: gt("Open Settings"), onPress: () => void Linking.openSettings() },
      ],
    );
  };

  const handleQrScan = (result: QrBarcodeScanPayload) => {
    if (scannerLocked) {
      return;
    }

    setScannerLocked(true);

    try {
      const pairingUrl = extractPairingUrlFromQrPayload(result.data);
      const { host, code } = parsePairingUrl(pairingUrl);
      const lockRect = extractBarcodeLockRect(result);
      setLockedRect(lockRect);
      setScannedHost(host);
      setHostInput(host);
      setCodeInput(code);
      onChangeConnectionPairingUrl(pairingUrl);
      setScanComplete(true);
      setScannerLocked(false);
      clearError();
      // Keep explicit user confirmation (B12): lock reticle & present in-place handshake card instead of auto-pairing.
      triggerSemanticHaptic("confirm");
    } catch (error) {
      triggerSemanticHaptic("reject");
      Dialog.alert(
        gt("Invalid QR code"),
        error instanceof Error
          ? (errorDisplayMessage(error, m) ?? error.message)
          : gt("Scanned QR code was not recognized."),
      );
      setTimeout(() => {
        setScannerLocked(false);
      }, 600);
    }
  };

  const handleSubmit = async () => {
    const pairingUrl = buildPairingUrl(hostInput, codeInput);
    setOwnAttempt(true);
    setSubmitError(null);
    setIsSubmitting(true);
    onChangeConnectionPairingUrl(pairingUrl);
    const outcome = await onConnectPress(pairingUrl, routeFor);
    setIsSubmitting(false);
    setSubmitError(outcome.error);
    triggerSemanticHaptic(outcome.ok ? "confirm" : "reject");
    if (outcome.ok) {
      // Replacing with Home would nest it inside any sheet below; return to the opener.
      if (!navigation.canGoBack()) {
        navigation.dispatch(StackActions.replace("Home"));
      } else {
        // Added from the Settings list, the new environment shows on Environments.
        leaveSettingsPage(navigation, workspaceHasColumns(), "SettingsEnvironments");
      }
    }
  };

  return (
    <SettingsScreen
      title={
        linked
          ? gt("Connect to {environment}", { environment: linked.label })
          : gt("Add environment")
      }
      actions={[
        {
          accessibilityLabel: connecting
            ? gt("Connecting", { $context: "connection status" })
            : gt("Add environment"),
          loading: connecting,
          icon: "checkmark",
          tintColor: headerIconColor,
          disabled: connectDisabled,
          onPress: () => {
            void handleSubmit();
          },
        },
      ]}
    >
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        <View collapsable={false} className="gap-6.5">
          <PairingScanCard
            cameraActive={cameraPermission?.granted === true && screenFocused && !scanComplete}
            scanComplete={scanComplete}
            lockedRect={lockedRect}
            screenFocused={screenFocused}
            onScan={handleQrScan}
            onScanPress={() => {
              void handleScanPress();
            }}
          />

          {scanComplete && (scannedHost || hostInput.trim().length > 0) ? (
            <PairingHandshakeCard
              host={hostInput.trim() || scannedHost || ""}
              connecting={connecting}
              error={pairingConnectionError}
              connectDisabled={connectDisabled}
              screenFocused={screenFocused}
              onConfirmConnect={() => {
                void handleSubmit();
              }}
              onRescan={() => {
                void handleScanPress();
              }}
            />
          ) : null}

          <View collapsable={false} className="gap-2">
            <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
              <T>Or enter it</T>
            </Text>
            <View
              collapsable={false}
              className={cn(
                "overflow-hidden rounded-[26px] border-continuous border bg-grouped-card",
                pairingConnectionError ? "border-danger-foreground" : "border-transparent",
              )}
            >
              <PairingInputRow
                label={gt("Address")}
                keyboardType="url"
                placeholder="192.168.1.100:3773"
                returnKeyType="next"
                submitBehavior="submit"
                value={hostInput}
                onChangeText={handleHostChange}
                onSubmitEditing={() => codeInputRef.current?.focus()}
              />
              <View className="ml-4 border-t border-border-subtle" />
              <PairingInputRow
                inputRef={codeInputRef}
                label={gt("Code", { $context: "pairing code field" })}
                placeholder={gt("Pairing code")}
                returnKeyType="go"
                value={codeInput}
                onChangeText={handleCodeChange}
                onSubmitEditing={() => {
                  if (!connectDisabled) void handleSubmit();
                }}
              />
            </View>
            <Text
              accessibilityLiveRegion="polite"
              className={cn(
                "px-4 text-sm leading-normal",
                pairingConnectionError ? "text-danger-foreground" : "text-foreground-muted",
              )}
            >
              {pairingConnectionError ??
                (linked
                  ? gt(
                      "Create a pairing code on {environment}, in its Settings → Sharing & access or with `t3 auth pairing create`, and enter it here.",
                      { environment: linked.label },
                    )
                  : gt(
                      "For machines on your local network or tailnet. The machine keeps its own provider credentials.",
                    ))}
            </Text>
            <View className="pt-2">
              <Button
                label={
                  connecting ? gt("Connecting", { $context: "connection status" }) : gt("Connect")
                }
                tone="primary"
                fullWidth
                loading={connecting}
                disabled={connectDisabled}
                onPress={() => {
                  void handleSubmit();
                }}
              />
            </View>
          </View>

          {hasCloudPublicConfig() ? <T3ConnectSection /> : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

const SCAN_CARD_HEIGHT = 250;
const SCAN_RETICLE_SIZE = 150;
const SCAN_RETICLE_TOP = 36;
const SCAN_RETICLE_RADIUS = 28;

function ReticleScanLine(props: { readonly focused: boolean }) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const animate = appActive && props.focused && !reducedMotion;
  const progress = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates a subtle native-driver scan line inside the active QR viewfinder
  useEffect(() => {
    progress.setValue(0);
    if (!animate) return;
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(progress, {
          toValue: 1,
          duration: 1800,
          easing: RNEasing.inOut(RNEasing.sin),
          useNativeDriver: true,
        }),
        RNAnimated.timing(progress, {
          toValue: 0,
          duration: 1800,
          easing: RNEasing.inOut(RNEasing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      progress.setValue(0);
    };
  }, [animate, progress]);

  if (!animate) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(SCAN_RETICLE_SIZE / 2 - 18), SCAN_RETICLE_SIZE / 2 - 18],
  });

  return (
    <RNAnimated.View
      pointerEvents="none"
      className="h-0.5 w-[72%] rounded-full bg-primary/80"
      style={{ transform: [{ translateY }] }}
    />
  );
}

function HandshakePulseDot(props: { readonly active: boolean; readonly focused: boolean }) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const pulse = useAnimatedValue(0, { useNativeDriver: true });
  const shouldPulse = props.active && appActive && props.focused && !reducedMotion;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives continuous handshake pulse on RN Animated native driver (obeys DISABLE_COMMIT_PAUSING_MECHANISM)
  useEffect(
    () => startNativePulseLoop(pulse, { active: shouldPulse, duration: 1200, mode: "breathe" }),
    [pulse, shouldPulse],
  );

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View className="size-4 items-center justify-center">
      {shouldPulse ? (
        <RNAnimated.View
          pointerEvents="none"
          className="absolute size-3 rounded-full bg-primary"
          style={{ opacity: ringOpacity, transform: [{ scale: ringScale }] }}
        />
      ) : null}
      <View className="size-2 rounded-full bg-primary" />
    </View>
  );
}

function PairingHandshakeCard(props: {
  readonly host: string;
  readonly connecting: boolean;
  readonly error: string | null;
  readonly connectDisabled: boolean;
  readonly screenFocused: boolean;
  readonly onConfirmConnect: () => void;
  readonly onRescan: () => void;
}) {
  const gt = useGT();
  const enterProgress = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- springs the in-place handshake card into view on QR lock-on
  useEffect(() => {
    enterProgress.set(withSpring(1, SPRING_SPATIAL_SNAPPY));
  }, [enterProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enterProgress.get(),
    transform: [{ translateY: (1 - enterProgress.get()) * 14 }],
  }));

  const activeStep: "confirm" | "handshake" | "error" = props.connecting
    ? "handshake"
    : props.error
      ? "error"
      : "confirm";

  return (
    <Reanimated.View
      collapsable={false}
      style={cardStyle}
      className={cn(
        "gap-3.5 rounded-[26px] border-continuous border bg-grouped-card p-4",
        props.error ? "border-danger-foreground/50" : "border-adaptive-emerald-600-400/35",
      )}
    >
      <View className="flex-row items-center gap-3">
        <View className="size-10 items-center justify-center rounded-2xl bg-subtle">
          {props.connecting ? (
            <HandshakePulseDot active focused={props.screenFocused} />
          ) : (
            <SymbolView
              name={props.error ? "exclamationmark.triangle" : "desktopcomputer"}
              size={18}
              tintColorClassName={
                props.error ? "accent-danger-foreground" : "accent-adaptive-emerald-600-400"
              }
              type="monochrome"
            />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm font-t3-bold text-foreground">
            {props.connecting
              ? gt("Handshaking with host")
              : props.error
                ? gt("Handshake failed")
                : gt("Ready to pair")}
          </Text>
          <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
            {props.host}
          </Text>
        </View>
      </View>

      {/* 3-step live handshake progress pills */}
      <View className="flex-row items-center gap-2">
        <HandshakeStepPill label={gt("Scanned")} status="done" />
        <View className="h-[1px] flex-1 bg-border-subtle" />
        <HandshakeStepPill
          label={gt("Confirm")}
          status={activeStep === "handshake" ? "done" : activeStep === "error" ? "error" : "active"}
        />
        <View className="h-[1px] flex-1 bg-border-subtle" />
        <HandshakeStepPill
          label={gt("Connect")}
          status={activeStep === "handshake" ? "active" : activeStep === "error" ? "error" : "idle"}
        />
      </View>

      {props.error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-xs leading-normal text-danger-foreground"
        >
          {props.error}
        </Text>
      ) : (
        <Text className="text-xs leading-normal text-foreground-muted">
          {props.connecting
            ? gt("Verifying one-time pairing credential with {host}…", { host: props.host })
            : gt("Confirm this host address before connecting.")}
        </Text>
      )}

      <View className="flex-row gap-2.5">
        <View className="flex-1">
          <Button
            label={gt("Scan again")}
            tone="secondary"
            fullWidth
            disabled={props.connecting}
            onPress={props.onRescan}
          />
        </View>
        <View className="flex-1">
          <Button
            label={
              props.connecting
                ? gt("Connecting", { $context: "connection status" })
                : props.error
                  ? gt("Retry handshake")
                  : gt("Confirm & connect")
            }
            tone="primary"
            fullWidth
            loading={props.connecting}
            disabled={props.connectDisabled}
            onPress={props.onConfirmConnect}
          />
        </View>
      </View>
    </Reanimated.View>
  );
}

function HandshakeStepPill(props: {
  readonly label: string;
  readonly status: "done" | "active" | "error" | "idle";
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        className={cn(
          "size-2 rounded-full",
          props.status === "done"
            ? "bg-adaptive-emerald-600-400"
            : props.status === "active"
              ? "bg-primary"
              : props.status === "error"
                ? "bg-danger-foreground"
                : "bg-foreground-muted/35",
        )}
      />
      <Text
        className={cn(
          "text-2xs font-t3-medium",
          props.status === "done"
            ? "text-adaptive-emerald-700-300"
            : props.status === "active"
              ? "text-foreground"
              : props.status === "error"
                ? "text-danger-foreground"
                : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </View>
  );
}

function PairingScanCard(props: {
  readonly cameraActive: boolean;
  readonly scanComplete: boolean;
  readonly lockedRect: FrostedCutoutLockRect | null;
  readonly screenFocused: boolean;
  readonly onScan: (result: QrBarcodeScanPayload) => void;
  readonly onScanPress: () => void;
}) {
  const gt = useGT();
  const light = useAppearancePreferences().themeAppearance === "light";
  const showAndroidReticleOverlay =
    Platform.OS === "android" && (props.cameraActive || props.scanComplete);
  return (
    <Pressable
      accessibilityRole={props.cameraActive ? undefined : "button"}
      accessibilityLabel={props.cameraActive ? undefined : gt("Scan QR code")}
      disabled={props.cameraActive}
      onPress={props.onScanPress}
      className={cn(
        "overflow-hidden rounded-[26px] border-continuous",
        light ? "bg-white" : "bg-black",
      )}
      style={{ height: SCAN_CARD_HEIGHT }}
    >
      <Svg accessibilityElementsHidden height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <RadialGradient id="pairing-scan-backdrop" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={light ? "#f4f4f5" : "#2e2e2e"} />
            <Stop offset="100%" stopColor={light ? "#d9d9dc" : "#0e0e0e"} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#pairing-scan-backdrop)" height="100%" width="100%" />
      </Svg>

      {props.cameraActive ? (
        <CameraView
          active
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={props.onScan}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {props.cameraActive || props.scanComplete ? (
        <FrostedCutout
          cutoutTop={SCAN_RETICLE_TOP}
          cutoutWidth={SCAN_RETICLE_SIZE}
          cutoutHeight={SCAN_RETICLE_SIZE}
          cutoutRadius={SCAN_RETICLE_RADIUS}
          appearance={light ? "light" : "dark"}
          locked={props.scanComplete}
          lockRect={props.lockedRect}
        />
      ) : null}

      <View
        pointerEvents="none"
        className="absolute inset-x-0 items-center gap-3.5"
        style={{ top: SCAN_RETICLE_TOP }}
      >
        <View
          className={cn(
            "items-center justify-center gap-2 overflow-hidden border-continuous",
            showAndroidReticleOverlay
              ? "border border-transparent"
              : cn(
                  "border-[3px]",
                  props.scanComplete && !props.cameraActive
                    ? "border-adaptive-emerald-600-400"
                    : light
                      ? "border-black/70"
                      : "border-white/80",
                ),
          )}
          style={{
            borderRadius: SCAN_RETICLE_RADIUS,
            height: SCAN_RETICLE_SIZE,
            width: SCAN_RETICLE_SIZE,
          }}
        >
          {props.cameraActive ? (
            <ReticleScanLine focused={props.screenFocused} />
          ) : props.scanComplete ? (
            <>
              <SymbolView
                name="checkmark.circle.fill"
                size={42}
                tintColorClassName="accent-adaptive-emerald-600-400"
                type="monochrome"
              />
              <Text className="font-t3-medium text-sm text-adaptive-emerald-700-300">
                <T>Locked</T>
              </Text>
            </>
          ) : (
            <>
              <SymbolView
                name="qrcode.viewfinder"
                size={44}
                tintColorClassName={light ? "accent-black/60" : "accent-white/70"}
                type="monochrome"
                weight="light"
              />
              <Text
                className={cn("font-t3-medium text-sm", light ? "text-black/70" : "text-white/80")}
              >
                <T>Tap to scan</T>
              </Text>
            </>
          )}
        </View>
        <Text
          className={cn(
            "text-center text-sm",
            props.scanComplete && !props.cameraActive
              ? "font-t3-medium text-adaptive-emerald-700-300"
              : light
                ? "text-black/70"
                : "text-white/80",
          )}
        >
          {props.scanComplete && !props.cameraActive
            ? gt("QR locked. Confirm below to connect.")
            : gt("Scan the code from {command} or desktop Connections settings", {
                command: "t3 pair",
              })}
        </Text>
      </View>
    </Pressable>
  );
}

function T3ConnectSection() {
  const gt = useGT();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const { connectedEnvironments, onSetEnvironmentEnabled, onRemoveEnvironmentPress } =
    useRemoteConnections();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });

  return (
    <View collapsable={false} className="gap-2">
      <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
        <T>Or use the managed relay</T>
      </Text>
      {isSignedIn ? (
        <CloudEnvironmentRows
          connectedCloudEnvironments={connectedCloudEnvironments}
          onSetEnvironmentEnabled={onSetEnvironmentEnabled}
          onRemoveEnvironment={onRemoveEnvironmentPress}
          showHeader={false}
        />
      ) : (
        <ListRow
          label={gt("Sign in to {product}", { product: "T3 Connect" })}
          description={gt("Reach your machines from anywhere, no network setup.")}
          disabled={!isLoaded}
          onPress={() => navigation.navigate("SettingsAuth")}
        />
      )}
    </View>
  );
}

function PairingInputRow({
  label,
  inputRef,
  ...inputProps
}: Omit<AppTextInputProps, "accessibilityLabel" | "className"> & {
  readonly label: string;
  readonly inputRef?: Ref<ComponentRef<typeof AppTextInput>>;
}) {
  return (
    <View collapsable={false} className="min-h-[48px] flex-row items-center gap-3 px-4">
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="w-20 text-base leading-[23px] text-foreground-muted"
      >
        {label}
      </Text>
      <AppTextInput
        {...inputProps}
        ref={inputRef}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="center"
        className="min-h-[48px] flex-1 self-stretch rounded-none border-0 bg-transparent p-0 text-base leading-[23px]"
      />
    </View>
  );
}
