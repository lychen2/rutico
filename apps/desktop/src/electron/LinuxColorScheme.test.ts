// @effect-diagnostics nodeBuiltinImport:off -- Event-driven fake of the portal transport.
import * as NodeEvents from "node:events";
import { DBusError, Message, MessageType, Variant, type MessageBus } from "dbus-next";
import { expect, it, vi } from "vite-plus/test";

import type { LinuxPortalAppearance } from "@t3tools/contracts";
import {
  watchLinuxColorScheme,
  watchLinuxPortalAppearance,
  type LinuxColorScheme,
} from "./LinuxColorScheme.ts";

const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";

class FakeBus extends NodeEvents.EventEmitter {
  calls: Message[] = [];
  disconnect = vi.fn();
  readonly settings: { readOne?: unknown; read?: unknown };
  constructor(settings: { readOne?: unknown; read?: unknown }) {
    super();
    this.settings = settings;
  }

  readonly readOneCalled = Promise.withResolvers<void>();

  async call(message: Message) {
    this.calls.push(message);
    if (message.member === "AddMatch")
      return new Message({ type: MessageType.METHOD_RETURN, replySerial: "1" });
    if (message.member === "ReadOne") this.readOneCalled.resolve();
    const value = await (message.member === "ReadOne" ? this.settings.readOne : this.settings.read);
    if (value === undefined) throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
    return new Message({
      type: MessageType.METHOD_RETURN,
      replySerial: "1",
      signature: "v",
      body: [value],
    });
  }

  changed(namespace: string, key: string, value: number) {
    this.emit(
      "message",
      new Message({
        type: MessageType.SIGNAL,
        path: PATH,
        interface: SETTINGS,
        member: "SettingChanged",
        body: [namespace, key, new Variant("u", value)],
      }),
    );
  }
}

function watch(bus: FakeBus) {
  const schemes: LinuxColorScheme[] = [];
  const { ready, stop } = watchLinuxColorScheme(
    (scheme) => schemes.push(scheme),
    bus as unknown as MessageBus,
  );
  return { schemes, ready, stop };
}

it("reads the current color scheme and follows portal changes", async () => {
  const bus = new FakeBus({ readOne: new Variant("u", 1) });
  const { schemes, ready, stop } = watch(bus);
  await ready;

  bus.changed("org.freedesktop.appearance", "color-scheme", 2);
  bus.changed("org.freedesktop.appearance", "accent-color", 1);
  bus.changed("org.gnome.desktop.interface", "color-scheme", 1);
  bus.changed("org.freedesktop.appearance", "color-scheme", 1);
  // GNOME's light mode reports "no preference".
  bus.changed("org.freedesktop.appearance", "color-scheme", 0);
  bus.changed("org.freedesktop.appearance", "color-scheme", 3);
  expect(schemes).toEqual(["dark", "light", "dark", "light", null]);

  stop();
  bus.changed("org.freedesktop.appearance", "color-scheme", 1);
  expect(schemes).toEqual(["dark", "light", "dark", "light", null]);
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("falls back to the nested Read reply on portals without ReadOne", async () => {
  const bus = new FakeBus({ read: new Variant("v", new Variant("u", 2)) });
  const { schemes, ready } = watch(bus);
  await ready;

  expect(schemes).toEqual(["light"]);
  expect(bus.calls.map((call) => call.member)).toEqual(["AddMatch", "ReadOne", "Read"]);
});

it("keeps a change that arrives while the initial read is pending", async () => {
  const reply = Promise.withResolvers<Variant>();
  const bus = new FakeBus({ readOne: reply.promise });
  const { schemes, ready } = watch(bus);

  await bus.readOneCalled.promise;
  bus.changed("org.freedesktop.appearance", "color-scheme", 1);
  reply.resolve(new Variant("u", 0));
  await ready;

  expect(schemes).toEqual(["dark"]);
});

class PortalFakeBus extends NodeEvents.EventEmitter {
  calls: Message[] = [];
  disconnect = vi.fn();
  readonly readAll?: unknown;
  readonly readOneByKey: Record<string, unknown>;
  readonly readByKey: Record<string, unknown>;
  readonly keyCallNotifiers = new Map<string, PromiseWithResolvers<void>>();

  constructor(options: {
    readAll?: unknown;
    readOneByKey?: Record<string, unknown>;
    readByKey?: Record<string, unknown>;
  }) {
    super();
    this.readAll = options.readAll;
    this.readOneByKey = options.readOneByKey ?? {};
    this.readByKey = options.readByKey ?? {};
  }

  waitForKeyCall(key: string): Promise<void> {
    let resolver = this.keyCallNotifiers.get(key);
    if (!resolver) {
      resolver = Promise.withResolvers<void>();
      this.keyCallNotifiers.set(key, resolver);
    }
    return resolver.promise;
  }

  async call(message: Message) {
    this.calls.push(message);
    if (message.member === "AddMatch") {
      return new Message({ type: MessageType.METHOD_RETURN, replySerial: "1" });
    }
    if (message.member === "ReadAll") {
      const value = await this.readAll;
      if (value === undefined) {
        throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
      }
      return new Message({
        type: MessageType.METHOD_RETURN,
        replySerial: "1",
        signature: "a{sa{sv}}",
        body: [value],
      });
    }
    const key = String(message.body[1] ?? "");
    if (message.member === "ReadOne") {
      const notifier = this.keyCallNotifiers.get(key);
      notifier?.resolve();
      const value = await this.readOneByKey[key];
      if (value === undefined) {
        throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
      }
      return new Message({
        type: MessageType.METHOD_RETURN,
        replySerial: "1",
        signature: "v",
        body: [value],
      });
    }
    const value = await this.readByKey[key];
    if (value === undefined) {
      throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
    }
    return new Message({
      type: MessageType.METHOD_RETURN,
      replySerial: "1",
      signature: "v",
      body: [value],
    });
  }

  signal(namespace: string, key: string, variant: Variant) {
    this.emit(
      "message",
      new Message({
        type: MessageType.SIGNAL,
        path: PATH,
        interface: SETTINGS,
        member: "SettingChanged",
        body: [namespace, key, variant],
      }),
    );
  }
}

it("decodes color-scheme, accent-color, and contrast from ReadAll and live SettingChanged without wiping sibling keys", async () => {
  const bus = new PortalFakeBus({
    readAll: {
      "org.freedesktop.appearance": {
        "color-scheme": new Variant("u", 1),
        "accent-color": new Variant("(ddd)", [0.21, 0.52, 0.89]),
        contrast: new Variant("u", 1),
      },
    },
  });
  const updates: LinuxPortalAppearance[] = [];
  const { ready, stop } = watchLinuxPortalAppearance(
    (appearance) => updates.push(appearance),
    bus as unknown as MessageBus,
  );
  await ready;

  expect(updates).toEqual([
    {
      colorScheme: "dark",
      accentColor: { r: 0.21, g: 0.52, b: 0.89 },
      contrast: "high",
    },
  ]);

  // Updating contrast must preserve colorScheme and accentColor.
  bus.signal("org.freedesktop.appearance", "contrast", new Variant("u", 0));
  expect(updates.at(-1)).toEqual({
    colorScheme: "dark",
    accentColor: { r: 0.21, g: 0.52, b: 0.89 },
    contrast: "no-preference",
  });

  // Updating accent-color with out-of-range / NaN / wrong-arity tuples clears accentColor only.
  bus.signal("org.freedesktop.appearance", "accent-color", new Variant("(ddd)", [-0.1, 0.5, 0.5]));
  expect(updates.at(-1)).toEqual({
    colorScheme: "dark",
    accentColor: null,
    contrast: "no-preference",
  });
  bus.signal(
    "org.freedesktop.appearance",
    "accent-color",
    new Variant("(ddd)", [Number.NaN, 0.2, 0.4]),
  );
  expect(updates.at(-1)?.accentColor).toBeNull();
  bus.signal("org.freedesktop.appearance", "accent-color", new Variant("(dd)", [0.2, 0.4]));
  expect(updates.at(-1)?.accentColor).toBeNull();

  // Valid nested Variant accent-color restores accent while keeping colorScheme & contrast intact.
  bus.signal(
    "org.freedesktop.appearance",
    "accent-color",
    new Variant("v", new Variant("(ddd)", [0.91, 0.33, 0.13])),
  );
  expect(updates.at(-1)).toEqual({
    colorScheme: "dark",
    accentColor: { r: 0.91, g: 0.33, b: 0.13 },
    contrast: "no-preference",
  });

  // Unknown contrast enum value decodes to null without affecting sibling keys.
  bus.signal("org.freedesktop.appearance", "contrast", new Variant("u", 99));
  expect(updates.at(-1)).toEqual({
    colorScheme: "dark",
    accentColor: { r: 0.91, g: 0.33, b: 0.13 },
    contrast: null,
  });

  stop();
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("falls back to legacy nested Read per key and isolates per-key initial-read races", async () => {
  const slowColorScheme = Promise.withResolvers<Variant>();
  const slowAccentColor = Promise.withResolvers<Variant>();
  const bus = new PortalFakeBus({
    readOneByKey: {
      "color-scheme": slowColorScheme.promise,
      "accent-color": slowAccentColor.promise,
    },
    readByKey: {
      contrast: new Variant("v", new Variant("u", 1)),
    },
  });
  const updates: LinuxPortalAppearance[] = [];
  const { ready, stop } = watchLinuxPortalAppearance(
    (appearance) => updates.push(appearance),
    bus as unknown as MessageBus,
  );

  await Promise.all([bus.waitForKeyCall("color-scheme"), bus.waitForKeyCall("accent-color")]);

  // Live signal for color-scheme arrives while initial reads are in flight.
  bus.signal("org.freedesktop.appearance", "color-scheme", new Variant("u", 1));

  // Stale initial color-scheme read settles to light (0) -> must be ignored!
  slowColorScheme.resolve(new Variant("u", 0));
  // Initial accent-color read settles with valid RGB -> must be applied without clobbering color-scheme!
  slowAccentColor.resolve(new Variant("(ddd)", [0.24, 0.68, 0.91]));
  await ready;

  expect(updates.at(-1)).toEqual({
    colorScheme: "dark",
    accentColor: { r: 0.24, g: 0.68, b: 0.91 },
    contrast: "high",
  });

  stop();
});
