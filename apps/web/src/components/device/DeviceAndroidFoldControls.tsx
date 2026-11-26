import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { m } from "~/i18n/messages";
import * as Schema from "effect/Schema";
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { T, useGT } from "gt-react";
import { AlertCircle, Laptop, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import {
  ANDROID_FOLD_TABLETOP_ANGLE,
  AndroidFoldError,
  formatAndroidFoldAngle,
  setAndroidFold,
  type AndroidFoldPosture,
} from "./deviceFold";
import { androidFoldReadAtom, androidFoldViewAtom, foldAngle, NOOP_ATOM } from "./deviceHubAtoms";
import { DeviceDuoGlyph } from "./DeviceDuoGlyph";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";

const isAndroidFoldError = Schema.is(AndroidFoldError);

export function DeviceAndroidFoldControls(props: {
  readonly access: DeviceHubAccess;
  readonly deviceKey: string;
  readonly deviceId: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly screenWidth: number | undefined;
  readonly screenHeight: number | undefined;
  readonly renewAccess: () => Promise<DeviceHubAccess | null>;
}) {
  const gt = useGT();
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPosture, setLastPosture] = useState<AndroidFoldPosture>("opened");
  const busy = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const { access, deviceKey, deviceId, visible, enabled, screenWidth, screenHeight } = props;
  const viewAtom = androidFoldViewAtom(deviceKey);
  const { fold, angle: viewAngle } = useAtomValue(viewAtom);
  const setView = useAtomSet(viewAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the fold settle pulse timer on unmount
  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  // A change in flight owns the posture; reading meanwhile could show the old one.
  useAtomMount(
    visible && enabled && !pending && screenWidth && screenHeight
      ? androidFoldReadAtom({ deviceKey, access, deviceId, screenWidth, screenHeight })
      : NOOP_ATOM,
  );

  if (!fold?.supported || !props.visible) return null;

  const displayAngle = viewAngle ?? foldAngle(fold);
  const isTabletopPreview = viewAngle === ANDROID_FOLD_TABLETOP_ANGLE && !pending;

  const setAngle = (angle: number) => setView((current) => ({ ...current, angle }));
  const triggerSettlePulse = () => {
    setSettled(true);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      setSettled(false);
      settleTimerRef.current = null;
    }, 650);
  };

  const toggleTabletopPreview = () => {
    if (pending || !props.enabled) return;
    setAngle(isTabletopPreview ? foldAngle(fold) : ANDROID_FOLD_TABLETOP_ANGLE);
  };

  const change = (posture: AndroidFoldPosture) => {
    if (busy.current || !props.enabled) return;
    busy.current = true;
    setLastPosture(posture);
    setPending(true);
    setSettled(false);
    setError(null);
    setAngle(posture === "closed" ? 0 : 180);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const send = (access: DeviceHubAccess) =>
      setAndroidFold(access, props.deviceId, posture, controller.signal);
    void send(props.access)
      .catch(async (cause: unknown) => {
        // Hub tickets expire after a few minutes, while the panel stays open much longer.
        if (!(isAndroidFoldError(cause) && cause.status === 401)) throw cause;
        const renewed = await props.renewAccess();
        if (!renewed || controller.signal.aborted) throw cause;
        return send(renewed);
      })
      .then((next) => {
        setView({ fold: next, angle: foldAngle(next) });
        triggerSettlePulse();
      })
      .catch((cause: unknown) => {
        setAngle(foldAngle(fold));
        setError(
          controller.signal.aborted
            ? gt("Fold command timed out.")
            : (thrownErrorMessage(cause, m) ?? gt("Could not change fold posture.")),
        );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        busy.current = false;
        setPending(false);
      });
  };

  return (
    <div aria-label={gt("Android fold controls")} className="flex flex-col items-center gap-1.5">
      <div
        ref={observeVisibleAnimation}
        data-fold-pending={pending ? "true" : undefined}
        data-fold-settled={settled ? "true" : undefined}
        className={cn(
          "surface-optical-chrome surface-elevated-rim pointer-events-auto flex shrink-0 flex-col items-center gap-1 rounded-full p-1",
          pending && "device-fold-pending",
          settled && "device-fold-settled",
        )}
      >
        <span
          aria-live="polite"
          aria-label={gt("Hinge angle {angle}", { angle: formatAndroidFoldAngle(displayAngle) })}
          data-slot="android-fold-angle-telemetry"
          className={cn(
            "select-none px-1 pt-0.5 font-mono text-3xs font-medium tabular-nums transition-colors duration-150",
            settled ? "text-success" : isTabletopPreview ? "text-primary" : "text-muted-foreground",
          )}
        >
          {formatAndroidFoldAngle(displayAngle)}
        </span>
        <SharedTooltipTrigger
          render={
            <Button
              size="icon"
              variant={fold.posture === "closed" && !isTabletopPreview ? "secondary" : "ghost"}
              aria-label={gt("Fold device")}
              aria-pressed={fold.posture === "closed" && !isTabletopPreview}
              disabled={pending || !props.enabled}
              onClick={() => change("closed")}
            />
          }
          label={
            <>
              <T>Fold device (0°)</T>
            </>
          }
          side="left"
        >
          <DeviceDuoGlyph pose="closed" />
        </SharedTooltipTrigger>
        <SharedTooltipTrigger
          render={
            <Button
              size="icon"
              variant={isTabletopPreview ? "secondary" : "ghost"}
              aria-label={gt("Preview 90° tabletop posture")}
              aria-pressed={isTabletopPreview}
              disabled={pending || !props.enabled}
              onClick={toggleTabletopPreview}
            />
          }
          label={
            <>
              <T>Preview 90° tabletop posture</T>
            </>
          }
          side="left"
        >
          <Laptop className="size-3.5" />
        </SharedTooltipTrigger>
        <SharedTooltipTrigger
          render={
            <Button
              size="icon"
              variant={fold.posture === "opened" && !isTabletopPreview ? "secondary" : "ghost"}
              aria-label={gt("Unfold device")}
              aria-pressed={fold.posture === "opened" && !isTabletopPreview}
              disabled={pending || !props.enabled}
              onClick={() => change("opened")}
            />
          }
          label={
            <>
              <T>Unfold device (180°)</T>
            </>
          }
          side="left"
        >
          <DeviceDuoGlyph pose="open" />
        </SharedTooltipTrigger>
      </div>
      {error ? (
        <SharedTooltipTrigger
          render={
            <button
              type="button"
              role="alert"
              aria-label={gt("{error} Click to retry.", { error })}
              onClick={() => change(lastPosture)}
              className="surface-optical-chrome pointer-events-auto inline-flex cursor-pointer items-center gap-0.5 rounded-full border border-destructive/50 px-1.5 py-0.5 text-3xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <AlertCircle className="size-3 shrink-0" />
              <RotateCw className="size-2.5 shrink-0" />
            </button>
          }
          label={gt("{error} Click to retry.", { error })}
          side="left"
        />
      ) : null}
    </div>
  );
}
