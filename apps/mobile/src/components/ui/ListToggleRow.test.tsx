import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn(() => Promise.resolve()),
}));
vi.mock("uniwind", () => ({
  useResolveClassNames: () => ({ backgroundColor: "#00000010" }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
}));
vi.mock("./RowPressable", () => ({
  RowPressable: (props: {
    readonly children?: ReactNode;
    readonly accessibilityLabel?: string;
    readonly accessibilityRole?: string;
    readonly accessibilityState?: { readonly checked?: boolean; readonly disabled?: boolean };
    readonly onPress?: () => void;
  }) => (
    <button
      role={props.accessibilityRole}
      aria-label={props.accessibilityLabel}
      aria-checked={props.accessibilityState?.checked}
      disabled={props.accessibilityState?.disabled}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  ),
}));
vi.mock("./AppText", () => ({ AppText: (props: { children?: ReactNode }) => props.children }));
vi.mock("./ListRowLayout", () => ({
  ListRowLayout: (props: { readonly label?: string; readonly accessory?: ReactNode }) => (
    <>
      <span>{props.label}</span>
      {props.accessory}
    </>
  ),
}));
vi.mock("./ThemedSwitch", () => ({ ThemedSwitch: () => null }));

import { ListToggleRow } from "./ListToggleRow";

it("sets a mixed row on, then off when an older environment drops it", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const saves: boolean[] = [];
  try {
    // The older environment dropped the unknown key, so the row stays mixed after every save.
    act(() =>
      root.render(
        <ListToggleRow
          label="Clone into host folders"
          value={null}
          onValueChange={(value) => saves.push(value)}
        />,
      ),
    );
    const button = () => container.querySelector("button")!;

    act(() => button().click());
    const offer = {
      text: button().querySelector("div")?.textContent,
      label: button().getAttribute("aria-label"),
    };
    act(() => button().click());

    expect(saves).toEqual([true, false]);
    expect(offer).toEqual({
      text: "Mixed · Set off",
      label: "Set Clone into host folders off for selected environments",
    });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("toggles a boolean row when tapping anywhere on the row", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const saves: boolean[] = [];
  try {
    act(() =>
      root.render(
        <ListToggleRow
          label="Render math"
          value={false}
          onValueChange={(value) => saves.push(value)}
        />,
      ),
    );
    const row = container.querySelector("button")!;
    expect(row.getAttribute("role")).toBe("switch");
    expect(row.getAttribute("aria-checked")).toBe("false");

    act(() => row.click());

    expect(saves).toEqual([true]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
