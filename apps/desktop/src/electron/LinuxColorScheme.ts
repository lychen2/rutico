import type {
  LinuxPortalAccentColor,
  LinuxPortalAppearance,
  LinuxPortalContrast,
} from "@t3tools/contracts";
import { Message, MessageType, Variant, sessionBus, type MessageBus } from "dbus-next";

const PORTAL = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const DBUS = "org.freedesktop.DBus";
const NAMESPACE = "org.freedesktop.appearance";
const COLOR_SCHEME_KEY = "color-scheme";
const ACCENT_COLOR_KEY = "accent-color";
const CONTRAST_KEY = "contrast";

export type LinuxColorScheme = "dark" | "light" | null;

function unwrapVariant(value: unknown): unknown {
  let current = value;
  while (current instanceof Variant) current = current.value;
  return current;
}

// The portal reports 1 for prefer-dark, 2 for prefer-light and 0 for no preference. GNOME's
// light mode is 0, and the spec asks apps to use their default then, so only 1 is dark.
// The deprecated Read method nests the value in a second variant.
function decodeColorScheme(value: unknown): LinuxColorScheme {
  const scheme = unwrapVariant(value);
  return scheme === 1 ? "dark" : scheme === 0 || scheme === 2 ? "light" : null;
}

// XDG Settings portal org.freedesktop.appearance.accent-color is a (ddd) sRGB tuple in [0, 1].
// Values outside [0, 1] or non-finite values indicate no accent preference per the spec.
function decodeAccentColor(value: unknown): LinuxPortalAccentColor | null {
  const tuple = unwrapVariant(value);
  if (!Array.isArray(tuple) || tuple.length !== 3) return null;
  const r = unwrapVariant(tuple[0]);
  const g = unwrapVariant(tuple[1]);
  const b = unwrapVariant(tuple[2]);
  if (
    typeof r !== "number" ||
    typeof g !== "number" ||
    typeof b !== "number" ||
    !Number.isFinite(r) ||
    !Number.isFinite(g) ||
    !Number.isFinite(b) ||
    r < 0 ||
    r > 1 ||
    g < 0 ||
    g > 1 ||
    b < 0 ||
    b > 1
  ) {
    return null;
  }
  return { r, g, b };
}

// XDG Settings portal org.freedesktop.appearance.contrast is a uint32 enum: 0 = no preference, 1 = high.
function decodeContrast(value: unknown): LinuxPortalContrast | null {
  const contrast = unwrapVariant(value);
  return contrast === 1 ? "high" : contrast === 0 ? "no-preference" : null;
}

const settingsCall = (member: "ReadOne" | "Read", key: string = COLOR_SCHEME_KEY) =>
  new Message({
    destination: PORTAL,
    path: PATH,
    interface: SETTINGS,
    member,
    signature: "ss",
    body: [NAMESPACE, key],
  });

const readAllCall = () =>
  new Message({
    destination: PORTAL,
    path: PATH,
    interface: SETTINGS,
    member: "ReadAll",
    signature: "as",
    body: [[NAMESPACE]],
  });

function extractAppearanceEntries(replyBody: unknown): Readonly<Record<string, unknown>> | null {
  const root = unwrapVariant(replyBody);
  if (root === null || typeof root !== "object") return null;
  const namespaceValue =
    root instanceof Map
      ? root.get(NAMESPACE)
      : Object.hasOwn(root, NAMESPACE)
        ? (root as Record<string, unknown>)[NAMESPACE]
        : undefined;
  const entries = unwrapVariant(namespaceValue);
  if (entries === null || typeof entries !== "object") return null;
  if (entries instanceof Map) {
    const record: Record<string, unknown> = {};
    for (const [key, val] of entries.entries()) {
      if (typeof key === "string") record[key] = val;
    }
    return record;
  }
  return entries as Record<string, unknown>;
}

/**
 * Follows the desktop color scheme through the XDG settings portal. Without a session bus or
 * portal it reports nothing, so Chromium's own resolution stays in charge.
 */
export function watchLinuxColorScheme(
  onChange: (scheme: LinuxColorScheme) => void,
  bus: MessageBus = sessionBus(),
) {
  let closed = false;
  let changed = false;
  const report = (value: unknown) => {
    if (!closed) onChange(decodeColorScheme(value));
  };
  const onMessage = (message: Message) => {
    if (
      message.type !== MessageType.SIGNAL ||
      message.path !== PATH ||
      message.interface !== SETTINGS ||
      message.member !== "SettingChanged"
    )
      return;
    const [namespace, key, value] = message.body;
    if (namespace !== NAMESPACE || key !== COLOR_SCHEME_KEY) return;
    changed = true;
    report(value);
  };
  const ignore = () => undefined;

  bus.on("error", ignore);
  bus.on("message", onMessage);
  const ready = (async () => {
    await bus.call(
      new Message({
        destination: DBUS,
        path: "/org/freedesktop/DBus",
        interface: DBUS,
        member: "AddMatch",
        signature: "s",
        body: [
          `type='signal',interface='${SETTINGS}',member='SettingChanged',path='${PATH}',arg0='${NAMESPACE}',arg1='${COLOR_SCHEME_KEY}'`,
        ],
      }),
    );
    // ReadOne needs Settings portal version 2; older portals only offer Read.
    const reply = await bus
      .call(settingsCall("ReadOne"))
      .catch(() => bus.call(settingsCall("Read")));
    // The portal answers reads through its backend asynchronously, so a change signal can
    // overtake this reply; the reply then carries the older value.
    if (reply && !changed) report(reply.body[0]);
  })().catch(ignore);

  return {
    ready,
    stop: () => {
      closed = true;
      bus.removeListener("message", onMessage);
      bus.disconnect();
    },
  };
}

/**
 * Follows all three XDG Desktop Portal `org.freedesktop.appearance` keys (`color-scheme`,
 * `accent-color`, and `contrast`) on a single session-bus connection with per-key race isolation.
 */
export function watchLinuxPortalAppearance(
  onChange: (appearance: LinuxPortalAppearance) => void,
  bus: MessageBus = sessionBus(),
) {
  let closed = false;
  const state: {
    colorScheme: LinuxColorScheme;
    accentColor: LinuxPortalAccentColor | null;
    contrast: LinuxPortalContrast | null;
  } = {
    colorScheme: null,
    accentColor: null,
    contrast: null,
  };
  const seenSignal = {
    colorScheme: false,
    accentColor: false,
    contrast: false,
  };

  const emitSnapshot = () => {
    if (closed) return;
    onChange({
      colorScheme: state.colorScheme,
      accentColor: state.accentColor ? { ...state.accentColor } : null,
      contrast: state.contrast,
    });
  };

  const onMessage = (message: Message) => {
    if (
      message.type !== MessageType.SIGNAL ||
      message.path !== PATH ||
      message.interface !== SETTINGS ||
      message.member !== "SettingChanged"
    ) {
      return;
    }
    const [namespace, key, value] = message.body;
    if (namespace !== NAMESPACE) return;
    if (key === COLOR_SCHEME_KEY) {
      seenSignal.colorScheme = true;
      state.colorScheme = decodeColorScheme(value);
      emitSnapshot();
    } else if (key === ACCENT_COLOR_KEY) {
      seenSignal.accentColor = true;
      state.accentColor = decodeAccentColor(value);
      emitSnapshot();
    } else if (key === CONTRAST_KEY) {
      seenSignal.contrast = true;
      state.contrast = decodeContrast(value);
      emitSnapshot();
    }
  };
  const ignore = () => undefined;

  const readSingleKey = async (key: string) =>
    bus
      .call(settingsCall("ReadOne", key))
      .catch(() => bus.call(settingsCall("Read", key)))
      .catch(() => undefined);

  bus.on("error", ignore);
  bus.on("message", onMessage);
  const ready = (async () => {
    await bus.call(
      new Message({
        destination: DBUS,
        path: "/org/freedesktop/DBus",
        interface: DBUS,
        member: "AddMatch",
        signature: "s",
        body: [
          `type='signal',interface='${SETTINGS}',member='SettingChanged',path='${PATH}',arg0='${NAMESPACE}'`,
        ],
      }),
    );

    const allReply = await bus.call(readAllCall()).catch(() => undefined);
    const entries = allReply ? extractAppearanceEntries(allReply.body[0]) : null;
    if (entries !== null) {
      let applied = false;
      if (Object.hasOwn(entries, COLOR_SCHEME_KEY) && !seenSignal.colorScheme) {
        state.colorScheme = decodeColorScheme(entries[COLOR_SCHEME_KEY]);
        applied = true;
      }
      if (Object.hasOwn(entries, ACCENT_COLOR_KEY) && !seenSignal.accentColor) {
        state.accentColor = decodeAccentColor(entries[ACCENT_COLOR_KEY]);
        applied = true;
      }
      if (Object.hasOwn(entries, CONTRAST_KEY) && !seenSignal.contrast) {
        state.contrast = decodeContrast(entries[CONTRAST_KEY]);
        applied = true;
      }
      if (applied) emitSnapshot();
      return;
    }

    // Older portals or partial implementations without ReadAll fall back to per-key ReadOne/Read.
    await Promise.all([
      readSingleKey(COLOR_SCHEME_KEY).then((reply) => {
        if (!reply || seenSignal.colorScheme) return;
        state.colorScheme = decodeColorScheme(reply.body[0]);
        emitSnapshot();
      }),
      readSingleKey(ACCENT_COLOR_KEY).then((reply) => {
        if (!reply || seenSignal.accentColor) return;
        state.accentColor = decodeAccentColor(reply.body[0]);
        emitSnapshot();
      }),
      readSingleKey(CONTRAST_KEY).then((reply) => {
        if (!reply || seenSignal.contrast) return;
        state.contrast = decodeContrast(reply.body[0]);
        emitSnapshot();
      }),
    ]);
  })().catch(ignore);

  return {
    ready,
    stop: () => {
      closed = true;
      bus.removeListener("message", onMessage);
      bus.removeListener("error", ignore);
      bus.disconnect();
    },
  };
}
