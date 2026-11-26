import { requireOptionalNativeModule } from "expo";
import { useEffect, useEffectEvent } from "react";
import { DeviceEventEmitter, Platform } from "react-native";
import {
  ReduceMotion,
  cancelAnimation,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import {
  createPredictiveBackArbiter,
  type PredictiveBackEdge,
  type PredictiveBackEvent,
  type PredictiveBackLayer,
  type PredictiveBackOwnerHandlers,
  type RawPredictiveBackPayload,
} from "./androidPredictiveBackArbiter";

export {
  createPredictiveBackArbiter,
  type PredictiveBackArbiter,
  type PredictiveBackEdge,
  type PredictiveBackEvent,
  type PredictiveBackLayer,
  type PredictiveBackOwnerHandlers,
  type PredictiveBackPhase,
  type RawPredictiveBackPayload,
} from "./androidPredictiveBackArbiter";

interface NativeWorkspaceNavigationModule {
  setModalBackOwnerCount?: (count: number) => void;
  setPanelBackOwnerCount?: (count: number) => void;
  addListener?: (
    eventName: "onPredictiveBack",
    listener: (payload: RawPredictiveBackPayload) => void,
  ) => { remove(): void };
}

const nativeNavigationModule: NativeWorkspaceNavigationModule | null =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeWorkspaceNavigationModule>("T3WorkspaceNavigation")
    : null;

let externalModalCount = 0;
let registeredModalCount = 0;

function syncNativeModalCount(): void {
  nativeNavigationModule?.setModalBackOwnerCount?.(externalModalCount + registeredModalCount);
}

const sharedArbiter = createPredictiveBackArbiter(({ modal, panel }) => {
  registeredModalCount = modal;
  syncNativeModalCount();
  nativeNavigationModule?.setPanelBackOwnerCount?.(panel);
});

let nativeBridgeRefs = 0;
let detachNativeBridge: (() => void) | null = null;

function retainNativeBridge(): () => void {
  if (Platform.OS !== "android") return () => undefined;
  nativeBridgeRefs += 1;
  if (nativeBridgeRefs === 1) {
    const compatSub = DeviceEventEmitter.addListener(
      "t3PredictiveBack",
      (payload: RawPredictiveBackPayload) => {
        sharedArbiter.dispatch({ ...payload, source: payload.source ?? "compat" });
      },
    );
    const nativePanelSub = nativeNavigationModule?.addListener?.("onPredictiveBack", (payload) => {
      sharedArbiter.dispatch({ ...payload, source: payload.source ?? "native-panel" });
    });
    detachNativeBridge = () => {
      compatSub.remove();
      nativePanelSub?.remove();
      detachNativeBridge = null;
    };
  }
  return () => {
    nativeBridgeRefs = Math.max(0, nativeBridgeRefs - 1);
    if (nativeBridgeRefs === 0) {
      detachNativeBridge?.();
    }
  };
}

/**
 * Registers a single-owner Android Predictive Back consumer.
 * Designed so side panels (e.g. AndroidPaseoPanels), modals, and stack navigators can plug into
 * deterministic priority arbitration (`modal -> rail -> panel -> screen-stack`) without competing.
 */
export function registerPredictiveBackOwner(handlers: PredictiveBackOwnerHandlers): () => void {
  if (Platform.OS !== "android") return () => undefined;
  const releaseBridge = retainNativeBridge();
  const unregister = sharedArbiter.register(handlers);
  return () => {
    unregister();
    releaseBridge();
  };
}

/** Reports active modal overlay routes to the native rail/panel arbitration coordinator. */
export function useSyncAndroidModalBackCount(modalCount: number): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes active modal count with native Android predictive-back owner arbitration
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const clamped = Math.max(0, Math.trunc(modalCount));
    externalModalCount += clamped;
    syncNativeModalCount();
    return () => {
      externalModalCount = Math.max(0, externalModalCount - clamped);
      syncNativeModalCount();
    };
  }, [modalCount]);
}

export interface UseAndroidPredictiveBackOwnerOptions extends PredictiveBackOwnerHandlers {
  readonly enabled: boolean;
}

/** Subscribes an active UI layer to Android Predictive Back single-owner events. */
export function useAndroidPredictiveBackOwner(options: UseAndroidPredictiveBackOwnerOptions): void {
  const handleStart = useEffectEvent((event: PredictiveBackEvent) => options.onStart?.(event));
  const handleProgress = useEffectEvent((event: PredictiveBackEvent) =>
    options.onProgress?.(event),
  );
  const handleCancel = useEffectEvent((event: PredictiveBackEvent) => options.onCancel?.(event));
  const handleCommit = useEffectEvent((event: PredictiveBackEvent) => options.onCommit?.(event));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to native Android predictive back events while this owner is active
  useEffect(() => {
    if (Platform.OS !== "android" || !options.enabled) return;
    return registerPredictiveBackOwner({
      layer: options.layer,
      onStart: handleStart,
      onProgress: handleProgress,
      onCancel: handleCancel,
      onCommit: handleCommit,
    });
  }, [options.enabled, options.layer]);
}

const CANCEL_SPRING_CONFIG = {
  damping: 26,
  stiffness: 320,
  mass: 0.85,
  reduceMotion: ReduceMotion.System,
} as const;

export interface AndroidPredictiveBackProgressValues {
  /** 0 at rest, 0..1 while edge-swiping back. */
  readonly progress: SharedValue<number>;
  /** 0 for left edge, 1 for right edge. */
  readonly swipeEdge: SharedValue<PredictiveBackEdge>;
}

/**
 * Convenience hook returning Reanimated SharedValues driven by Android Predictive Back events
 * for the specified single-owner layer. Automatically springs back to 0 on cancel and resets
 * cleanly on commit or disable.
 */
export function useAndroidPredictiveBackProgress(options: {
  readonly layer: PredictiveBackLayer;
  readonly enabled: boolean;
  readonly onCommit?: (event: PredictiveBackEvent) => void;
}): AndroidPredictiveBackProgressValues {
  const progress = useSharedValue(0);
  const swipeEdge = useSharedValue<PredictiveBackEdge>(0);

  useAndroidPredictiveBackOwner({
    layer: options.layer,
    enabled: options.enabled,
    onStart: (event) => {
      cancelAnimation(progress);
      swipeEdge.set(event.swipeEdge);
      progress.set(event.progress);
    },
    onProgress: (event) => {
      swipeEdge.set(event.swipeEdge);
      progress.set(event.progress);
    },
    onCancel: () => {
      progress.set(withSpring(0, CANCEL_SPRING_CONFIG));
    },
    onCommit: (event) => {
      progress.set(withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System }));
      options.onCommit?.(event);
    },
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets shared predictive-back progress when the layer becomes inactive
  useEffect(() => {
    if (!options.enabled) {
      cancelAnimation(progress);
      progress.set(0);
    }
  }, [options.enabled, progress]);

  return { progress, swipeEdge };
}
