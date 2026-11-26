import {
  Box,
  Button,
  Column,
  getMaterialColors,
  Image,
  Row,
  Spacer,
  Text,
} from "@expo/ui/jetpack-compose";
import {
  background,
  cornerRadius,
  fillMaxSize,
  fillMaxWidth,
  height,
  padding,
  paddingAll,
  size,
  width,
} from "@expo/ui/jetpack-compose/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type {
  SubscriptionUsageSnapshot as SubscriptionUsageProps,
  WidgetLimitAccount,
} from "./subscriptionUsageSnapshot";

export function SubscriptionUsage(props: SubscriptionUsageProps, environment: WidgetEnvironment) {
  "widget";
  // The widget runtime evaluates this function without the app's module scope.
  const now = Date.now();
  const mode = props.theme?.mode;
  const appearance =
    mode === "light" || mode === "dark"
      ? mode
      : environment.colorScheme === "dark"
        ? "dark"
        : "light";
  const palette = props.theme?.[appearance];
  const material = getMaterialColors({ scheme: appearance });
  const isDark = appearance === "dark";
  const colors = palette
    ? {
        surface: palette.background,
        surfaceTonal: material.surfaceContainerHigh,
        onSurface: palette.foreground,
        muted: palette.secondary,
        track: palette.track,
        error: palette.danger,
        healthy: isDark ? "#34D399" : "#15803D",
        warning: isDark ? "#FBBF24" : "#D97706",
        staleContainer: isDark ? "#3F2A14" : "#FEF3C7",
        onStaleContainer: isDark ? "#FDE68A" : "#92400E",
      }
    : {
        surface: material.surfaceContainer,
        surfaceTonal: material.surfaceContainerHigh,
        onSurface: material.onSurface,
        muted: material.onSurfaceVariant,
        track: material.surfaceVariant,
        error: material.error,
        healthy: isDark ? "#34D399" : "#15803D",
        warning: isDark ? "#FBBF24" : "#D97706",
        staleContainer: material.errorContainer,
        onStaleContainer: material.onErrorContainer,
      };
  // Normalize #RRGGBB and #RRGGBBAA hex strings before applying an alpha channel.
  const withHexAlpha = (hex: string, alphaHex: string) => {
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    return base.length === 7 ? `${base}${alphaHex}` : hex;
  };
  const rateColor = (remaining: number) =>
    remaining <= 10 ? colors.error : remaining <= 40 ? colors.warning : colors.healthy;
  // English until the app publishes its first snapshot in the UI language.
  const text = props.text ?? {
    refresh: "Open Rutico to refresh",
    left: "left",
    asOf: "As of {time}",
    tapToConnect: "Tap to connect in Rutico",
    moreInApp: {} as Record<string, string>,
  };
  const providers = props.providers ?? [
    {
      name: "Codex",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open Rutico to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
    {
      name: "Claude",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open Rutico to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
  ];

  const pad = 16;
  const labelWidth = 96;
  const footer = 18;
  const widgetWidth = environment.width ?? 320;
  const contentWidth = widgetWidth - pad * 2;
  const contentHeight = (environment.height ?? 200) - pad * 2 - footer;
  const kindOrder: Record<string, number> = { session: 0, weekly: 1 };

  type Line =
    | {
        type: "window";
        provider: string;
        color: string;
        window: SubscriptionUsageProps["providers"][number]["windows"][number];
      }
    | { type: "note"; provider: string; color: string; text: string; stale: boolean };
  const lines: Line[] = providers.flatMap((provider): Line[] => {
    const providerColor = provider.colors?.[appearance] ?? colors.onSurface;
    const stale =
      provider.windows.length > 0 && provider.expiresAt > 0 && now >= provider.expiresAt;
    if (stale || provider.windows.length === 0)
      return [
        {
          type: "note",
          provider: provider.name,
          color: providerColor,
          text: stale ? text.refresh : provider.detail,
          stale,
        },
      ];
    return [...provider.windows]
      .sort((a, b) => (kindOrder[a.kind ?? ""] ?? 2) - (kindOrder[b.kind ?? ""] ?? 2))
      .map((window) => ({
        type: "window",
        provider: provider.name,
        color: providerColor,
        window,
      }));
  });
  const hasStaleReading = lines.some((line) => line.type === "note" && line.stale);

  // The snapshot keeps a few windows per provider; the rest still count toward "N more".
  const dropped = providers.reduce(
    (sum, provider) =>
      lines.some((line) => line.type === "window" && line.provider === provider.name)
        ? sum + Math.max(0, (provider.totalWindows ?? 0) - provider.windows.length)
        : sum,
    0,
  );
  const slots = lines.length + (dropped > 0 ? 1 : 0);
  // Roomy rows when every limit fits, thin bars when they would not.
  const fullRow = 34;
  const compactRow = 20;
  const full = slots * fullRow <= contentHeight;
  // Glance columns hold at most ten children, the overflow note included.
  const capacity = Math.max(
    1,
    Math.min(9, Math.floor(contentHeight / (full ? fullRow : compactRow))),
  );
  const shown = slots > capacity ? lines.slice(0, capacity - 1) : lines;
  const hidden = lines.length - shown.length + dropped;
  // Rows share any spare height so short lists do not bunch at the top.
  const rowHeight = Math.min(
    full ? 52 : 28,
    contentHeight / Math.max(1, shown.length + (hidden > 0 ? 1 : 0)),
  );

  const timeLeft = (account: WidgetLimitAccount) =>
    account.resetsAt && account.durationMs
      ? Math.max(0, Math.min(1, (account.resetsAt - now) / account.durationMs))
      : null;
  const paceArrow = (accounts: WidgetLimitAccount[]) => {
    const timed = accounts.flatMap((account) => {
      const left = timeLeft(account);
      return left === null || account.remaining === undefined
        ? []
        : [{ used: 100 - account.remaining, elapsed: 1 - left }];
    });
    if (timed.length === 0) return "";
    const gap = timed.reduce((sum, t) => sum + t.used - t.elapsed * 100, 0) / timed.length;
    return gap > 5 ? " ↗" : gap < -5 ? " ↘" : " →";
  };

  const segment = (
    account: WidgetLimitAccount,
    fallbackColor: string,
    segmentWidth: number,
    barHeight: number,
    labels: { name: boolean; percent: boolean; reset: boolean },
  ) => {
    if (account.remaining === undefined)
      return <Spacer key={account.name} modifiers={[size(segmentWidth, barHeight)]} />;
    const barRadius = barHeight >= 16 ? 8 : 4;
    const fill = (segmentWidth * account.remaining) / 100;
    const refill = (segmentWidth * Math.min(100 - account.remaining, account.refill ?? 0)) / 100;
    const left = timeLeft(account);
    const tick =
      left === null ? null : Math.max(0, Math.min(segmentWidth - 5, segmentWidth * left - 2.5));
    const semanticColor = rateColor(account.remaining);
    const fillTint = withHexAlpha(semanticColor, "66");
    const hatchTint = account.color ?? fallbackColor;
    return (
      <Box
        key={account.name}
        modifiers={[
          size(segmentWidth, barHeight),
          background(colors.track),
          cornerRadius(barRadius),
        ]}
      >
        {fill > 0 ? (
          <Box modifiers={[size(fill, barHeight), background(fillTint), cornerRadius(barRadius)]} />
        ) : null}
        {refill > 0 ? (
          <Row modifiers={[size(segmentWidth, barHeight)]}>
            <Spacer modifiers={[width(segmentWidth - refill)]} />
            <Image
              source={{ uri: "t3_widget_hatch" }}
              tint={hatchTint}
              alpha={0.22}
              contentScale="fillBounds"
              modifiers={[size(refill, barHeight)]}
            />
          </Row>
        ) : null}
        {tick === null ? null : (
          <Row modifiers={[size(segmentWidth, barHeight)]}>
            <Spacer modifiers={[width(tick)]} />
            <Box
              contentAlignment="center"
              modifiers={[size(5, barHeight), background(colors.surface)]}
            >
              <Box
                modifiers={[
                  size(2, Math.max(2, barHeight - 4)),
                  background(colors.onSurface),
                  cornerRadius(1),
                ]}
              />
            </Box>
          </Row>
        )}
        {labels.percent ? (
          <Row
            verticalAlignment="center"
            modifiers={[size(segmentWidth, barHeight), padding(6, 0, 6, 0)]}
          >
            {labels.name ? (
              <Text color={colors.onSurface} maxLines={1} style={{ fontSize: 10 }}>
                {`${account.name} `}
              </Text>
            ) : null}
            <Text
              color={account.remaining <= 40 ? semanticColor : colors.onSurface}
              maxLines={1}
              style={{ fontSize: 10, fontWeight: "bold" }}
            >
              {`${account.remaining}%`}
            </Text>
          </Row>
        ) : null}
        {labels.reset && account.reset ? (
          <Box
            contentAlignment="centerEnd"
            modifiers={[size(segmentWidth, barHeight), padding(0, 0, 4, 0)]}
          >
            <Box modifiers={[background(colors.surface), cornerRadius(6), padding(4, 1, 4, 1)]}>
              <Text color={colors.onSurface} maxLines={1} style={{ fontSize: 9 }}>
                {`↻ ${account.reset}`}
              </Text>
            </Box>
          </Box>
        ) : null}
      </Box>
    );
  };

  const bar = (line: Extract<Line, { type: "window" }>, barWidth: number, barHeight: number) => {
    const fallback: WidgetLimitAccount = { name: line.provider, remaining: line.window.remaining };
    const listed = line.window.accounts ?? [];
    // Glance rows hold at most ten children: five segments and their gaps.
    const accounts = listed.length > 0 && listed.length <= 5 ? listed : [fallback];
    const gap = 3;
    const segmentWidth = (barWidth - gap * (accounts.length - 1)) / accounts.length;
    const multi = accounts.length > 1;
    return (
      <Row modifiers={[size(barWidth, barHeight)]}>
        {accounts.flatMap((account, index) => [
          index > 0 ? <Spacer key={`gap-${account.name}`} modifiers={[width(gap)]} /> : null,
          segment(account, account.color ?? line.color, segmentWidth, barHeight, {
            percent: barHeight >= 16 && multi && segmentWidth >= 34,
            name: multi && segmentWidth >= 76,
            reset: barHeight >= 16 && !multi && segmentWidth >= 120,
          }),
        ])}
      </Row>
    );
  };

  const percentText = (remaining: number, fontSize: number) => (
    <Text
      color={remaining <= 40 ? rateColor(remaining) : colors.onSurface}
      maxLines={1}
      style={{ fontSize, fontWeight: "bold" }}
    >
      {`${remaining}%`}
    </Text>
  );

  const row = (line: Line) => {
    const label = `${line.provider} ${line.type === "window" ? line.window.label : ""}`.trim();
    if (line.type === "note")
      return (
        <Row
          key={`${line.provider}-note`}
          verticalAlignment="center"
          modifiers={[fillMaxWidth(), height(rowHeight)]}
        >
          <Box modifiers={[size(6, 6), background(line.color), cornerRadius(3)]} />
          <Spacer modifiers={[width(6)]} />
          <Text color={colors.onSurface} maxLines={1} style={{ fontSize: 11, fontWeight: "bold" }}>
            {`${line.provider}  `}
          </Text>
          {line.stale ? (
            <Box
              modifiers={[background(colors.staleContainer), cornerRadius(10), padding(6, 1, 6, 1)]}
            >
              <Text
                color={colors.onStaleContainer}
                maxLines={1}
                style={{ fontSize: 10, fontWeight: "bold" }}
              >
                {line.text}
              </Text>
            </Box>
          ) : (
            <Text color={colors.muted} maxLines={1} style={{ fontSize: 11 }}>
              {line.text}
            </Text>
          )}
        </Row>
      );
    if (!full)
      return (
        <Row key={label} verticalAlignment="center" modifiers={[fillMaxWidth(), height(rowHeight)]}>
          <Box modifiers={[size(5, 5), background(line.color), cornerRadius(3)]} />
          <Spacer modifiers={[width(5)]} />
          <Text
            color={colors.muted}
            maxLines={1}
            style={{ fontSize: 10 }}
            modifiers={[width(labelWidth - 10)]}
          >
            {label}
          </Text>
          {bar(line, contentWidth - labelWidth - 40, 8)}
          <Box contentAlignment="centerEnd" modifiers={[width(40)]}>
            {percentText(line.window.remaining, 10)}
          </Box>
        </Row>
      );
    return (
      <Row key={label} verticalAlignment="center" modifiers={[fillMaxWidth(), height(rowHeight)]}>
        <Column modifiers={[width(labelWidth)]}>
          <Row verticalAlignment="center">
            <Box modifiers={[size(6, 6), background(line.color), cornerRadius(3)]} />
            <Spacer modifiers={[width(5)]} />
            <Text color={colors.muted} maxLines={1} style={{ fontSize: 10 }}>
              {label}
            </Text>
          </Row>
          <Row verticalAlignment="bottom">
            {percentText(line.window.remaining, 18)}
            <Text
              color={colors.muted}
              maxLines={1}
              style={{ fontSize: 10 }}
              modifiers={[padding(3, 0, 0, 3)]}
            >
              {`${text.left}${paceArrow(line.window.accounts ?? [])}`}
            </Text>
          </Row>
        </Column>
        <Spacer modifiers={[width(8)]} />
        {bar(line, contentWidth - labelWidth - 8, 22)}
      </Row>
    );
  };

  return (
    // The native SubscriptionUsageProvider (via withAndroidWidgetDeepLink.cjs) binds this root
    // Button to a BAL-compliant Activity actionStartActivity PendingIntent so cold-start taps open Usage.
    <Button
      colors={{ containerColor: colors.surface }}
      modifiers={[fillMaxSize(), cornerRadius(24)]}
      onClick={() => {}}
    >
      <Column modifiers={[fillMaxSize(), paddingAll(pad)]}>
        <Column modifiers={[fillMaxWidth(), height(contentHeight)]}>
          {shown.map(row)}
          {hidden > 0 ? (
            <Text color={colors.muted} maxLines={1} style={{ fontSize: 10 }}>
              {/* oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text */}
              {text.moreInApp[String(hidden)] ?? `${hidden} more in Rutico`}
            </Text>
          ) : null}
        </Column>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), height(footer)]}>
          <Text color={colors.muted} maxLines={1} style={{ fontSize: 10 }}>
            {props.checkedAt
              ? text.asOf.replace(
                  "{time}",
                  new Date(props.checkedAt).toLocaleString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                  }),
                )
              : text.tapToConnect}
          </Text>
          {hasStaleReading ? (
            <Box modifiers={[padding(6, 0, 0, 0)]}>
              <Box
                modifiers={[
                  background(colors.staleContainer),
                  cornerRadius(8),
                  padding(5, 1, 5, 1),
                ]}
              >
                <Text
                  color={colors.onStaleContainer}
                  maxLines={1}
                  style={{ fontSize: 9, fontWeight: "bold" }}
                >
                  {"↻"}
                </Text>
              </Box>
            </Box>
          ) : null}
        </Row>
      </Column>
    </Button>
  );
}

export default createWidget("SubscriptionUsage", SubscriptionUsage);
