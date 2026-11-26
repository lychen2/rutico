import { THEME_COLOR_ROLES, getThemeColorVariable, type ThemeColorRole } from "../../themePalette";

export type ThemePaintKind = "background" | "border" | "foreground";

export type ThemePaintSnapshot = Readonly<Record<ThemePaintKind, string>>;
export type ThemeElementInspection = Readonly<{
  element: Element;
  role: ThemeColorRole;
}>;

const THEME_PAINT_KIND_ORDER: ReadonlyArray<ThemePaintKind> = [
  "background",
  "border",
  "foreground",
];

const THEME_INSPECTOR_MATCH_ATTRIBUTE = "data-theme-inspector-match";

const THEME_TOKEN_PROBE_ATTRIBUTE = "data-theme-token-probe";
const THEME_TOKEN_PROBE_COLOR = "#01fea7";
const THEME_TOKEN_ALTERNATE_PROBE_COLOR = "#fe01a7";
const THEME_SPOTLIGHT_ID = "theme-inspector-spotlight";
const THEME_SPOTLIGHT_MASK_ID = "theme-inspector-spotlight-mask";
const THEME_SPOTLIGHT_GLOW_ID = "theme-inspector-spotlight-glow";
const THEME_HOVER_ID = "theme-inspector-hover";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const THEME_UTILITY_ROLES: Readonly<Partial<Record<string, ThemeColorRole>>> = {
  background: "canvas",
  foreground: "text",
  card: "surface",
  "card-foreground": "text",
  popover: "surfaceOverlay",
  "popover-foreground": "text",
  "surface-raised": "surfaceRaised",
  primary: "messageAction",
  "primary-foreground": "messageActionForeground",
  secondary: "secondary",
  "secondary-foreground": "secondaryForeground",
  muted: "muted",
  "muted-foreground": "mutedForeground",
  placeholder: "placeholder",
  "secondary-label": "secondaryLabel",
  "icon-muted": "iconMuted",
  accent: "accentSurface",
  "accent-foreground": "accentSurfaceForeground",
  destructive: "error",
  "destructive-foreground": "errorForeground",
  error: "error",
  "error-foreground": "errorForeground",
  "error-surface": "errorSurface",
  warning: "warning",
  "warning-foreground": "warningForeground",
  "warning-surface": "warningSurface",
  update: "update",
  "update-foreground": "updateForeground",
  "update-surface": "updateSurface",
  message: "messageSurface",
  "message-foreground": "messageForeground",
  "message-action": "messageAction",
  "message-action-foreground": "messageActionForeground",
  "message-action-hover": "messageActionHover",
  sidebar: "sidebar",
  "sidebar-foreground": "sidebarForeground",
  "sidebar-muted-foreground": "sidebarMutedForeground",
  "sidebar-control-surface": "sidebarControlSurface",
  "sidebar-row-hover": "sidebarRowHover",
  "sidebar-row-active": "sidebarRowActive",
  "sidebar-row-selected": "sidebarRowSelected",
  "sidebar-border": "sidebarBorder",
  border: "border",
  input: "input",
  ring: "focus",
};

const THEME_UTILITY_PREFIXES: Readonly<Record<ThemePaintKind, ReadonlyArray<string>>> = {
  background: ["bg-"],
  border: ["border-", "outline-", "ring-"],
  foreground: ["text-", "caret-", "fill-", "stroke-"],
};

function clearThemeInspectorAttribute(attribute: string): void {
  document
    .querySelectorAll(`[${attribute}]`)
    .forEach((element) => element.removeAttribute(attribute));
}

export function clearThemeInspectorHighlights(): void {
  clearThemeInspectorAttribute(THEME_INSPECTOR_MATCH_ATTRIBUTE);
  document.getElementById(THEME_SPOTLIGHT_ID)?.remove();
}

export function clearThemeInspectorHover(): void {
  document.getElementById(THEME_HOVER_ID)?.remove();
}

function svgElement<Name extends keyof SVGElementTagNameMap>(
  name: Name,
): SVGElementTagNameMap[Name] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

function spotlightRect(element: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
} | null {
  const bounds = element.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.right < 0 ||
    bounds.bottom < 0 ||
    bounds.left > window.innerWidth ||
    bounds.top > window.innerHeight
  ) {
    return null;
  }

  const padding = 5;
  const x = bounds.left - padding;
  const y = bounds.top - padding;
  const elementRadius =
    Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius) || 0;
  return {
    x,
    y,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    radius: Math.min(18, Math.max(7, elementRadius + padding)),
  };
}

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];
type ContrastGrade = "AAA" | "AA" | "AA Large" | "Fail";

function parseCssAlpha(rawAlpha: string | undefined): number {
  if (rawAlpha === undefined) return 1;
  return rawAlpha.endsWith("%") ? Number.parseFloat(rawAlpha) / 100 : Number.parseFloat(rawAlpha);
}

function parseCssRgb(color: string): Rgba | null {
  const rgbMatch = color.match(
    /^rgba?\(\s*([\d.]+)(?:[\s,]+)([\d.]+)(?:[\s,]+)([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i,
  );
  if (rgbMatch) {
    const r = Number.parseFloat(rgbMatch[1]!);
    const g = Number.parseFloat(rgbMatch[2]!);
    const b = Number.parseFloat(rgbMatch[3]!);
    const a = parseCssAlpha(rgbMatch[4]);
    if ([r, g, b, a].some((channel) => Number.isNaN(channel))) return null;
    return [r, g, b, Math.max(0, Math.min(1, a))];
  }
  const srgbMatch = color.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (srgbMatch) {
    const r = Number.parseFloat(srgbMatch[1]!) * 255;
    const g = Number.parseFloat(srgbMatch[2]!) * 255;
    const b = Number.parseFloat(srgbMatch[3]!) * 255;
    const a = parseCssAlpha(srgbMatch[4]);
    if ([r, g, b, a].some((channel) => Number.isNaN(channel))) return null;
    return [r, g, b, Math.max(0, Math.min(1, a))];
  }
  return null;
}

function compositeOver(top: Rgba, bottom: Rgb): Rgb {
  const alpha = Math.max(0, Math.min(1, top[3]));
  return [
    top[0] * alpha + bottom[0] * (1 - alpha),
    top[1] * alpha + bottom[1] * (1 - alpha),
    top[2] * alpha + bottom[2] * (1 - alpha),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const toLinear = (channel: number) => {
    const normalized = Math.max(0, Math.min(1, channel / 255));
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function isLargeTextStyle(style: CSSStyleDeclaration): boolean {
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize)) return false;
  if (fontSize >= 24) return true;
  const rawWeight = style.fontWeight.trim().toLowerCase();
  const fontWeight = rawWeight === "bold" ? 700 : Number.parseFloat(rawWeight);
  return fontSize >= 18.66 && Number.isFinite(fontWeight) && fontWeight >= 700;
}

function resolveElementContrast(element: Element): {
  readonly ratio: number;
  readonly grade: ContrastGrade;
  readonly badge: string;
} | null {
  const elementStyle = window.getComputedStyle(element);
  const fg = parseCssRgb(elementStyle.color);
  if (!fg || fg[3] <= 0) return null;

  const layers: Array<{ readonly bg: Rgba | null; readonly opacity: number }> = [];
  let current: Element | null = element;
  let hasOpaqueBase = false;
  while (current) {
    const style = current === element ? elementStyle : window.getComputedStyle(current);
    const bg = parseCssRgb(style.backgroundColor);
    const parsedOpacity = Number.parseFloat(style.opacity);
    const opacity = Number.isFinite(parsedOpacity) ? Math.max(0, Math.min(1, parsedOpacity)) : 1;
    if (opacity <= 0) return null;
    layers.push({ bg, opacity });
    if (bg && bg[3] >= 1 && opacity >= 1) {
      hasOpaqueBase = true;
      break;
    }
    current = current.parentElement;
  }

  let baseIndex = layers.length - 1;
  if (!hasOpaqueBase) {
    baseIndex = -1;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const candidate = layers[index]!.bg;
      if (candidate && candidate[3] >= 0.85) {
        baseIndex = index;
        break;
      }
    }
    if (baseIndex < 0) return null;
  }

  const baseBg = layers[baseIndex]!.bg!;
  const backdropBefore: Array<Rgb> = new Array(baseIndex + 1);
  let resolvedBg: Rgb = [baseBg[0], baseBg[1], baseBg[2]];
  backdropBefore[baseIndex] = resolvedBg;
  for (let index = baseIndex - 1; index >= 0; index -= 1) {
    backdropBefore[index] = resolvedBg;
    const layer = layers[index]!;
    if (layer.bg && layer.bg[3] > 0) {
      resolvedBg = compositeOver(
        [layer.bg[0], layer.bg[1], layer.bg[2], layer.bg[3] * layer.opacity],
        resolvedBg,
      );
    }
  }

  const elementLayer = layers[0]!;
  const elementInnerBg =
    baseIndex === 0
      ? resolvedBg
      : elementLayer.bg && elementLayer.bg[3] > 0
        ? compositeOver(elementLayer.bg, backdropBefore[0]!)
        : backdropBefore[0]!;
  let resolvedFg = compositeOver(fg, elementInnerBg);
  for (let index = 0; index < baseIndex; index += 1) {
    const layer = layers[index]!;
    if (layer.opacity < 1) {
      resolvedFg = compositeOver(
        [resolvedFg[0], resolvedFg[1], resolvedFg[2], layer.opacity],
        backdropBefore[index]!,
      );
    }
  }

  const fgLum = relativeLuminance(resolvedFg);
  const bgLum = relativeLuminance(resolvedBg);
  const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
  if (!Number.isFinite(ratio) || ratio < 1.05) return null;

  const largeText = isLargeTextStyle(elementStyle);
  const grade: ContrastGrade =
    ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : largeText && ratio >= 3 ? "AA Large" : "Fail";
  const rounded = ratio.toFixed(1);
  return {
    ratio,
    grade,
    badge: `${grade} ${rounded}:1`,
  };
}

export function showThemeInspectorHover(inspection: ThemeElementInspection, label: string): void {
  const rectangle = spotlightRect(inspection.element);
  if (!rectangle) {
    clearThemeInspectorHover();
    return;
  }

  let hover = document.getElementById(THEME_HOVER_ID);
  const created = !hover;
  if (!hover) {
    hover = document.createElement("div");
    hover.id = THEME_HOVER_ID;
    hover.setAttribute("aria-hidden", "true");
    const tokenLabel = document.createElement("span");
    tokenLabel.dataset.themeInspectorHoverLabel = "";
    const textSpan = document.createElement("span");
    textSpan.dataset.themeInspectorHoverText = "";
    const contrastSpan = document.createElement("span");
    contrastSpan.dataset.themeInspectorHoverContrast = "";
    tokenLabel.append(textSpan, contrastSpan);
    hover.append(tokenLabel);
    document.body.append(hover);
  }

  hover.style.left = "0px";
  hover.style.top = "0px";
  hover.style.transform = `translate3d(${rectangle.x}px, ${rectangle.y}px, 0)`;
  hover.style.width = `${rectangle.width}px`;
  hover.style.height = `${rectangle.height}px`;
  hover.style.borderRadius = `${rectangle.radius}px`;
  hover.dataset.placement = rectangle.y < 32 ? "below" : "above";
  const textSpan = hover.querySelector<HTMLElement>("[data-theme-inspector-hover-text]");
  if (textSpan) textSpan.textContent = label;
  const contrastSpan = hover.querySelector<HTMLElement>("[data-theme-inspector-hover-contrast]");
  if (contrastSpan) {
    const contrast = resolveElementContrast(inspection.element);
    contrastSpan.textContent = contrast ? contrast.badge : "";
    if (contrast) {
      contrastSpan.dataset.contrastRatio = contrast.ratio.toFixed(2);
      contrastSpan.dataset.contrastGrade = contrast.grade;
    } else {
      delete contrastSpan.dataset.contrastRatio;
      delete contrastSpan.dataset.contrastGrade;
    }
  }

  if (created) {
    const createdHover = hover;
    window.requestAnimationFrame(() => {
      if (createdHover.isConnected) {
        createdHover.dataset.themeInspectorReady = "true";
      }
    });
  }
}

function renderThemeInspectorSpotlight(elements: ReadonlyArray<Element>): void {
  const rectangles = new Map<string, NonNullable<ReturnType<typeof spotlightRect>>>();
  for (const element of elements) {
    const rectangle = spotlightRect(element);
    if (!rectangle) continue;
    const key = [rectangle.x, rectangle.y, rectangle.width, rectangle.height]
      .map((value) => Math.round(value))
      .join(":");
    rectangles.set(key, rectangle);
  }

  if (rectangles.size === 0) {
    document.getElementById(THEME_SPOTLIGHT_ID)?.remove();
    return;
  }

  let spotlight = document.getElementById(THEME_SPOTLIGHT_ID) as SVGSVGElement | null;
  if (!spotlight) {
    spotlight = svgElement("svg");
    spotlight.id = THEME_SPOTLIGHT_ID;
    spotlight.setAttribute("aria-hidden", "true");
    spotlight.setAttribute("focusable", "false");
    document.body.append(spotlight);
  }
  spotlight.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);

  const definitions = svgElement("defs");
  const mask = svgElement("mask");
  mask.id = THEME_SPOTLIGHT_MASK_ID;
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const maskSurface = svgElement("rect");
  maskSurface.setAttribute("width", String(window.innerWidth));
  maskSurface.setAttribute("height", String(window.innerHeight));
  maskSurface.setAttribute("fill", "white");
  mask.append(maskSurface);

  const glowFilter = svgElement("filter");
  glowFilter.id = THEME_SPOTLIGHT_GLOW_ID;
  glowFilter.setAttribute("x", "-50%");
  glowFilter.setAttribute("y", "-50%");
  glowFilter.setAttribute("width", "200%");
  glowFilter.setAttribute("height", "200%");
  const blur = svgElement("feGaussianBlur");
  blur.setAttribute("stdDeviation", "5");
  blur.setAttribute("result", "blur");
  const merge = svgElement("feMerge");
  const blurredGlow = svgElement("feMergeNode");
  blurredGlow.setAttribute("in", "blur");
  const crispGlow = svgElement("feMergeNode");
  crispGlow.setAttribute("in", "SourceGraphic");
  merge.append(blurredGlow, crispGlow);
  glowFilter.append(blur, merge);
  definitions.append(mask, glowFilter);

  const glowGroup = svgElement("g");
  for (const rectangle of rectangles.values()) {
    const hole = svgElement("rect");
    hole.setAttribute("x", String(rectangle.x));
    hole.setAttribute("y", String(rectangle.y));
    hole.setAttribute("width", String(rectangle.width));
    hole.setAttribute("height", String(rectangle.height));
    hole.setAttribute("rx", String(rectangle.radius));
    hole.setAttribute("fill", "black");
    mask.append(hole);

    const glow = hole.cloneNode(false) as SVGRectElement;
    glow.removeAttribute("fill");
    glow.setAttribute("class", "theme-inspector-spotlight-glow");
    glow.setAttribute("filter", `url(#${THEME_SPOTLIGHT_GLOW_ID})`);
    glowGroup.append(glow);
  }

  const dimmer = svgElement("rect");
  dimmer.setAttribute("class", "theme-inspector-spotlight-dimmer");
  dimmer.setAttribute("width", String(window.innerWidth));
  dimmer.setAttribute("height", String(window.innerHeight));
  dimmer.setAttribute("mask", `url(#${THEME_SPOTLIGHT_MASK_ID})`);
  spotlight.replaceChildren(definitions, dimmer, glowGroup);
}

export function refreshThemeInspectorSpotlight(): void {
  renderThemeInspectorSpotlight([
    ...document.querySelectorAll(`[${THEME_INSPECTOR_MATCH_ATTRIBUTE}]`),
  ]);
}

function elementHasVisibleText(element: Element): boolean {
  if (element.matches("input, textarea, select, option")) return true;
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

function getThemePaintSnapshot(
  element: Element,
  { forHitTest = false }: { forHitTest?: boolean } = {},
): ThemePaintSnapshot | null {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return null;
  }

  const borderPaints: Array<string> = [];
  for (const [color, borderStyle, width] of [
    [style.borderTopColor, style.borderTopStyle, style.borderTopWidth],
    [style.borderRightColor, style.borderRightStyle, style.borderRightWidth],
    [style.borderBottomColor, style.borderBottomStyle, style.borderBottomWidth],
    [style.borderLeftColor, style.borderLeftStyle, style.borderLeftWidth],
  ] as const) {
    if (borderStyle !== "none" && Number.parseFloat(width) > 0) borderPaints.push(color);
  }
  if (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) {
    borderPaints.push(style.outlineColor);
  }
  if (style.borderImageSource !== "none") borderPaints.push(style.borderImageSource);
  if (style.boxShadow !== "none") borderPaints.push(style.boxShadow);

  const foregroundPaints: Array<string> = [];
  if (forHitTest || elementHasVisibleText(element)) foregroundPaints.push(style.color);
  if (element instanceof SVGElement) foregroundPaints.push(style.fill, style.stroke);
  if (element.matches("input, textarea")) foregroundPaints.push(style.caretColor);
  if (style.textDecorationLine !== "none") foregroundPaints.push(style.textDecorationColor);
  if (style.textShadow !== "none") foregroundPaints.push(style.textShadow);

  return {
    background: [style.backgroundColor, style.backgroundImage].join("\n"),
    border: borderPaints.join("\n"),
    foreground: foregroundPaints.join("\n"),
  };
}

function changedThemePaintKinds(
  before: ThemePaintSnapshot,
  after: ThemePaintSnapshot,
): ReadonlyArray<ThemePaintKind> {
  return THEME_PAINT_KIND_ORDER.filter((kind) => before[kind] !== after[kind]);
}

function withThemeTokenProbeSession<Result>(run: () => Result): Result {
  const root = document.documentElement;
  const wasAlreadyProbing = root.hasAttribute(THEME_TOKEN_PROBE_ATTRIBUTE);
  if (!wasAlreadyProbing) root.setAttribute(THEME_TOKEN_PROBE_ATTRIBUTE, "");
  try {
    return run();
  } finally {
    // Flush restored tokens before re-enabling transitions; no paint may occur during probing.
    void window.getComputedStyle(root).color;
    if (!wasAlreadyProbing) root.removeAttribute(THEME_TOKEN_PROBE_ATTRIBUTE);
  }
}

function applyThemeTokenProbe(role: ThemeColorRole): () => void {
  const root = document.documentElement;
  const variable = getThemeColorVariable(role);
  const originalValue = root.style.getPropertyValue(variable);
  const originalPriority = root.style.getPropertyPriority(variable);
  const resolvedValue = originalValue.trim().toLowerCase();
  const probeColor =
    resolvedValue === THEME_TOKEN_PROBE_COLOR
      ? THEME_TOKEN_ALTERNATE_PROBE_COLOR
      : THEME_TOKEN_PROBE_COLOR;
  root.style.setProperty(variable, probeColor, "important");

  return () => {
    if (originalValue) {
      root.style.setProperty(variable, originalValue, originalPriority);
    } else {
      root.style.removeProperty(variable);
    }
  };
}

function applyThemeTokenProbes(roles: ReadonlyArray<ThemeColorRole>): () => void {
  const restores = roles.map(applyThemeTokenProbe);
  return () => {
    for (const restore of restores.toReversed()) restore();
  };
}

function themeInspectorCandidates(): ReadonlyArray<Element> {
  return [document.body, ...document.body.querySelectorAll("*")].filter(
    (element) =>
      !element.closest("[data-theme-editor-panel]") &&
      !element.closest(`#${THEME_SPOTLIGHT_ID}, #${THEME_HOVER_ID}`),
  );
}

function themeRoleFromUtilityClass(className: string, kind: ThemePaintKind): ThemeColorRole | null {
  if (className.includes(":")) return null;
  for (const prefix of THEME_UTILITY_PREFIXES[kind]) {
    if (!className.startsWith(prefix)) continue;
    const colorName = className.slice(prefix.length).split("/", 1)[0] ?? "";
    return THEME_UTILITY_ROLES[colorName] ?? null;
  }
  return null;
}

function themeRoleFromUtilities(element: Element): ThemeColorRole | null {
  for (const kind of THEME_PAINT_KIND_ORDER) {
    for (const className of element.classList) {
      const role = themeRoleFromUtilityClass(className, kind);
      if (role) return role;
    }
  }
  return null;
}

function themeInspectionCandidates(initialElement: Element): ReadonlyArray<Element> {
  const candidates: Array<Element> = [];
  let element: Element | null = initialElement;
  while (element && element !== document.documentElement) {
    if (!element.closest("[data-theme-editor-panel]")) candidates.push(element);
    element = element.parentElement;
  }
  return candidates;
}

export function inspectThemeRoleFromUtilitiesAtElement(
  initialElement: Element,
): ThemeElementInspection | null {
  if (initialElement.closest("[data-theme-editor-panel]")) return null;
  for (const candidate of themeInspectionCandidates(initialElement)) {
    const role = themeRoleFromUtilities(candidate);
    if (role) return { element: candidate, role };
  }
  return null;
}

export function highlightThemeRoleUsage(roles: ReadonlyArray<ThemeColorRole>): number {
  clearThemeInspectorAttribute(THEME_INSPECTOR_MATCH_ATTRIBUTE);
  const candidates = themeInspectorCandidates();
  const matches = withThemeTokenProbeSession(() => {
    const baseline = new Map<Element, ThemePaintSnapshot>();
    for (const element of candidates) {
      const snapshot = getThemePaintSnapshot(element);
      if (snapshot) baseline.set(element, snapshot);
    }

    const restore = applyThemeTokenProbes(roles);
    const changed = new Set<Element>();
    try {
      for (const [element, before] of baseline) {
        const after = getThemePaintSnapshot(element);
        if (after && changedThemePaintKinds(before, after).length > 0) changed.add(element);
      }
    } finally {
      restore();
    }
    return changed;
  });

  const highlightedElements = new Set<Element>();
  for (const element of matches) {
    highlightedElements.add(
      element instanceof SVGElement ? (element.closest("svg") ?? element) : element,
    );
  }
  for (const element of highlightedElements) {
    element.setAttribute(THEME_INSPECTOR_MATCH_ATTRIBUTE, "");
  }
  renderThemeInspectorSpotlight([...highlightedElements]);
  return highlightedElements.size;
}

export function inspectThemeRoleAtElement(initialElement: Element): ThemeElementInspection | null {
  if (initialElement.closest("[data-theme-editor-panel]")) return null;

  const candidates = themeInspectionCandidates(initialElement);

  // Semantic Tailwind utilities reveal token dependencies without forced style recalculations per
  // pointerdown.
  const utilityInspection = inspectThemeRoleFromUtilitiesAtElement(initialElement);
  if (utilityInspection) return utilityInspection;

  const rolesByElement = withThemeTokenProbeSession(() => {
    const baseline = new Map<Element, ThemePaintSnapshot>();
    const roles = new Map<Element, Partial<Record<ThemePaintKind, ThemeColorRole>>>();
    for (const candidate of candidates) {
      const snapshot = getThemePaintSnapshot(candidate, { forHitTest: true });
      if (snapshot) baseline.set(candidate, snapshot);
    }

    for (const role of THEME_COLOR_ROLES) {
      const restore = applyThemeTokenProbe(role);
      try {
        for (const [candidate, before] of baseline) {
          const after = getThemePaintSnapshot(candidate, { forHitTest: true });
          if (!after) continue;
          const candidateRoles = roles.get(candidate) ?? {};
          for (const kind of changedThemePaintKinds(before, after)) {
            candidateRoles[kind] ??= role;
          }
          roles.set(candidate, candidateRoles);
        }
      } finally {
        restore();
      }
    }
    return roles;
  });

  for (const candidate of candidates) {
    const roles = rolesByElement.get(candidate);
    if (!roles) continue;
    for (const kind of THEME_PAINT_KIND_ORDER) {
      const role = roles[kind];
      if (role) return { element: candidate, role };
    }
  }
  return null;
}
