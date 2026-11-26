import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { withDeviceHubQuery } from "@t3tools/client-runtime/state/deviceHubAccess";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m } from "~/i18n/messages";

export type AndroidFoldPosture = "closed" | "opened";

export interface AndroidFoldState {
  readonly supported: boolean;
  readonly posture: "closed" | "half_opened" | "opened" | "flipped" | "tent" | null;
  readonly hingeAngle: number | null;
}

export class AndroidFoldError extends Schema.TaggedError<AndroidFoldError>()("AndroidFoldError", {
  message: Schema.String,
  status: Schema.Number,
}) {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseFold = (payload: unknown): AndroidFoldState => {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.fold)) {
    throw new Error(m(msg("Unexpected Android fold response.")));
  }
  const { supported, posture, hingeAngle } = payload.fold;
  if (
    typeof supported !== "boolean" ||
    (posture !== null &&
      posture !== "closed" &&
      posture !== "half_opened" &&
      posture !== "opened" &&
      posture !== "flipped" &&
      posture !== "tent") ||
    (hingeAngle !== null && (typeof hingeAngle !== "number" || !Number.isFinite(hingeAngle)))
  ) {
    throw new Error(m(msg("Unexpected Android fold response.")));
  }
  return { supported, posture, hingeAngle };
};

const foldRequest = async (
  access: DeviceHubAccess,
  deviceId: string,
  posture?: AndroidFoldPosture,
  signal?: AbortSignal,
): Promise<AndroidFoldState> => {
  const url = withDeviceHubQuery(
    `${access.httpBase}/vendor/serve-emu/api/fold?${new URLSearchParams({ device: deviceId })}`,
    access,
  );
  const response = await fetch(url, {
    method: posture ? "POST" : "GET",
    cache: "no-store",
    credentials: access.credentials ? "include" : "same-origin",
    ...(posture
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ posture }) }
      : {}),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error = isRecord(payload) ? payload.error : null;
    throw new AndroidFoldError({
      message:
        typeof error === "string"
          ? error
          : m(msg("Fold command failed ({status}).", { status: response.status })),
      status: response.status,
    });
  }
  return parseFold(await response.json());
};

export const readAndroidFold = (access: DeviceHubAccess, deviceId: string, signal?: AbortSignal) =>
  foldRequest(access, deviceId, undefined, signal);

export const setAndroidFold = (
  access: DeviceHubAccess,
  deviceId: string,
  posture: AndroidFoldPosture,
  signal?: AbortSignal,
) => foldRequest(access, deviceId, posture, signal);

export const ANDROID_FOLD_TABLETOP_ANGLE = 90;

/** Formats a hinge angle in degrees (`0°`–`180°`) for compact telemetry badges. */
export function formatAndroidFoldAngle(angle: number | null): string {
  if (angle === null || !Number.isFinite(angle)) return "--";
  const clamped = Math.max(0, Math.min(180, Math.round(angle)));
  return `${clamped}°`;
}

/** Builds a copyable Android / iOS Accessibility locator string for pasting into T3 Chat. */
export function formatDeviceAxLocator(
  element: {
    readonly id: string;
    readonly role: string;
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  screen: { readonly width: number; readonly height: number } | null,
): {
  readonly boundsLabel: string;
  readonly summary: string;
  readonly clipboardText: string;
} {
  const sw = screen?.width ?? 100;
  const sh = screen?.height ?? 100;
  const pxX = Math.round(element.x * sw);
  const pxY = Math.round(element.y * sh);
  const pxW = Math.round(element.width * sw);
  const pxH = Math.round(element.height * sh);
  const unit = screen ? "px" : "%";
  const boundsLabel = `${pxX},${pxY} · ${pxW}×${pxH}${unit}`;
  const parts = [element.role || "view", element.label || element.id].filter(
    (part) => part.length > 0,
  );
  const summary = `${parts.join(" · ")} · ${boundsLabel}`;
  const clipboardText = [
    element.role ? `role=${element.role}` : null,
    element.label ? `label=${JSON.stringify(element.label)}` : null,
    element.id ? `id=${element.id}` : null,
    `bounds=[${pxX},${pxY},${pxW}x${pxH}${unit}]`,
  ]
    .filter(Boolean)
    .join(" ");
  return { boundsLabel, summary, clipboardText };
}
