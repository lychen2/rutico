import { startPaletteThreadDrag } from "./CommandPalette.drag";
import { useLegendListRef } from "~/hooks/useLegendListRef";
import { useStableCallback } from "~/hooks/useStableCallback";
import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { T } from "gt-react";
import { createSpringKeyframes, prefersReducedMotion } from "~/lib/motion/springs";
import { useSharedIndicator } from "~/lib/motion/useSharedIndicator";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteRow,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandListHeading,
  CommandListVirtualized,
  CommandShortcut,
} from "./ui/command";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "./ui/empty";
import { getVirtualizedScrollFadeClassName } from "./ui/scroll-area";
import { ProjectPinButton } from "./ProjectPinButton";
import { SearchMatchHintLine, ThreadSearchMatchExcerpt } from "./ThreadSearchMatch";

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

function CommandPaletteEmptyState(props: { emptyStateMessage?: string; isActionsOnly: boolean }) {
  return (
    <Empty size="compact">
      <EmptyMedia variant="icon">
        <SearchIcon className="size-4.5 text-muted-foreground" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyDescription>
          {props.emptyStateMessage ??
            (props.isActionsOnly ? (
              <T>No matching actions.</T>
            ) : (
              <T>No matching commands, projects, or threads.</T>
            ))}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const ACTIVE_COMMAND_ITEM_SELECTOR =
  '[data-slot="command-item"][data-active="true"], [data-slot="command-item"][data-highlighted]';
const MAGNETIC_RAIL_INSTANT_JUMP_PX = 280;

interface RailRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function measureActiveCommandItem(container: HTMLElement): RailRect | null {
  const active =
    container.querySelector<HTMLElement>('[data-slot="command-item"][data-active="true"]') ??
    container.querySelector<HTMLElement>('[data-slot="command-item"][data-highlighted]');
  if (!active || !container.contains(active)) return null;
  const containerRect = container.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  if (itemRect.width <= 0 || itemRect.height <= 0) return null;
  // Hide rail cleanly when the active row is completely clipped outside the virtualized viewport.
  if (itemRect.bottom <= containerRect.top || itemRect.top >= containerRect.bottom) {
    return null;
  }
  return {
    x: itemRect.left - containerRect.left,
    y: itemRect.top - containerRect.top,
    width: itemRect.width,
    height: itemRect.height,
  };
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  useSharedIndicator({
    containerRef,
    indicatorRef: railRef,
    activeSelector: ACTIVE_COMMAND_ITEM_SELECTOR,
    activeKey: props.highlightedItemValue ?? null,
    preset: "snappy",
    axis: "y",
  });

  if (props.groups.length === 0) {
    return <CommandPaletteEmptyState {...props} />;
  }

  return (
    <div ref={containerRef} className="relative" data-command-magnetic-ready="true">
      <div ref={railRef} aria-hidden="true" inert data-slot="command-magnetic-rail" />
      <CommandList>
        {props.groups.map((group) => (
          <CommandGroup items={group.items} key={group.value}>
            {group.label ? <CommandGroupLabel>{group.label}</CommandGroupLabel> : null}
            <CommandCollection>
              {(item) =>
                item.disabled ? (
                  <DisabledCommandPaletteResultRow item={item} key={item.value} />
                ) : (
                  <CommandPaletteResultRow
                    item={item}
                    key={item.value}
                    keybindings={props.keybindings}
                    isActive={props.highlightedItemValue === item.value}
                    onExecuteItem={props.onExecuteItem}
                  />
                )
              }
            </CommandCollection>
          </CommandGroup>
        ))}
      </CommandList>
    </div>
  );
}

export function scrollCommandPaletteRowIntoView(
  list: LegendListRef | null,
  rowIndex: number,
  isFirstItem: boolean,
) {
  if (isFirstItem) {
    void list?.scrollToOffset({ offset: 0, animated: false });
    return;
  }
  void list?.scrollIndexIntoView({
    index: rowIndex,
    animated: false,
    viewportMargin: { start: 24, end: 24 },
  });
}

// Keeps a mounted row's old data when it shows the same item, so typing re-renders only the
// rows whose item or position changed.
function commandPaletteRowsAreEqual(previous: CommandPaletteRow, next: CommandPaletteRow) {
  if (previous.kind === "label" || next.kind === "label") {
    return (
      previous.kind === "label" &&
      next.kind === "label" &&
      previous.label === next.label &&
      previous.first === next.first
    );
  }
  return previous.item === next.item && previous.itemIndex === next.itemIndex;
}

interface CommandPaletteVirtualizedResultsProps extends Omit<CommandPaletteResultsProps, "groups"> {
  rows: ReadonlyArray<CommandPaletteRow>;
  listRef: RefObject<LegendListRef | null>;
}

/** Pass flat items with virtualized to Command, scroll highlights via listRef, and handle Enter for
 * unmounted rows. */
export function CommandPaletteVirtualizedResults(props: CommandPaletteVirtualizedResultsProps) {
  const { listRef } = props;
  // The palette rebuilds its handler every render; a stable one keeps rows from re-rendering.
  const onExecuteItem = useStableCallback(props.onExecuteItem);
  const [scrollFade, setScrollFade] = useState({ top: false, bottom: false });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const railStateRef = useRef<{
    lastRect: RailRect | null;
    lastKey: string | null | undefined;
    animation: Animation | null;
  }>({
    lastRect: null,
    lastKey: undefined,
    animation: null,
  });

  const syncMagneticRail = useStableCallback((animate: boolean) => {
    const container = containerRef.current;
    const rail = railRef.current;
    if (!container || !rail) return;

    const target = measureActiveCommandItem(container);
    const state = railStateRef.current;
    if (!target) {
      state.animation?.cancel();
      state.animation = null;
      state.lastRect = null;
      rail.style.opacity = "0";
      rail.removeAttribute("data-indicator-ready");
      delete container.dataset.commandMagneticReady;
      return;
    }

    const from = state.lastRect;
    state.animation?.cancel();
    state.animation = null;

    rail.style.width = `${target.width}px`;
    rail.style.height = `${target.height}px`;
    rail.style.transform = `translate3d(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px, 0)`;
    rail.style.opacity = "1";
    rail.setAttribute("data-indicator-ready", "true");
    container.dataset.commandMagneticReady = "true";
    state.lastRect = target;

    const win = container.ownerDocument.defaultView ?? globalThis.window;
    if (!animate || !from || prefersReducedMotion(win) || typeof rail.animate !== "function") {
      return;
    }

    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const dw = target.width - from.width;
    const dh = target.height - from.height;
    // Large jumps across virtualized viewports snap instantly to prevent motion sickness.
    if (
      (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dw) < 0.5 && Math.abs(dh) < 0.5) ||
      Math.abs(dy) > MAGNETIC_RAIL_INSTANT_JUMP_PX
    ) {
      return;
    }

    const samples = 24;
    const ySpring = createSpringKeyframes(from.y, target.y, "snappy", {
      samples,
      format: (v) => ({ v }) as unknown as Keyframe,
    });
    const hSpring = createSpringKeyframes(from.height, target.height, "snappy", {
      samples,
      format: (v) => ({ v }) as unknown as Keyframe,
    });
    const durationMs = Math.max(120, Math.min(240, ySpring.durationMs));
    const keyframes: Keyframe[] = [];
    for (let i = 0; i < samples; i += 1) {
      const curY = Number((ySpring.keyframes[i] as unknown as { v: number })?.v ?? target.y);
      const prevY = Number(
        (ySpring.keyframes[Math.max(0, i - 1)] as unknown as { v: number })?.v ?? curY,
      );
      const curH = Math.max(
        1,
        Number((hSpring.keyframes[i] as unknown as { v: number })?.v ?? target.height),
      );
      const speedRatio =
        i === 0 || i === samples - 1
          ? 0
          : Math.min(1, Math.abs(curY - prevY) / Math.max(12, target.height * 0.75));
      const squash = 0.12 * speedRatio;
      const scaleX = 1 - squash * 0.35;
      const scaleY = (curH / target.height) * (1 + squash * 0.45);
      keyframes.push({
        transform: `translate3d(${target.x.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
      });
    }
    const animation = rail.animate(keyframes, { duration: durationMs, easing: "linear" });
    state.animation = animation;
    animation.addEventListener(
      "finish",
      () => {
        if (state.animation === animation) state.animation = null;
      },
      { once: true },
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- glides the virtualized magnetic highlight rail by logical active item key
  useLayoutEffect(() => {
    const state = railStateRef.current;
    const keyChanged = state.lastKey !== props.highlightedItemValue;
    const hadPrevious = state.lastRect !== null;
    state.lastKey = props.highlightedItemValue;
    syncMagneticRail(keyChanged && hadPrevious);
  }, [props.highlightedItemValue, syncMagneticRail]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the magnetic highlight rail aligned on container resize and Base UI highlight mutations
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stopResize = observeResize(container, () => syncMagneticRail(false));
    const mutationObserver = new MutationObserver(() => {
      syncMagneticRail(true);
    });
    mutationObserver.observe(container, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-highlighted", "data-active"],
    });
    return () => {
      stopResize();
      mutationObserver.disconnect();
      railStateRef.current.animation?.cancel();
      railStateRef.current.animation = null;
    };
  }, [syncMagneticRail]);

  const updateScrollFade = () => {
    const metrics = listRef.current?.getState();
    if (metrics) {
      const top = !metrics.isAtStart;
      const bottom = !metrics.isAtEnd;
      setScrollFade((current) =>
        current.top === top && current.bottom === bottom ? current : { top, bottom },
      );
    }
    syncMagneticRail(false);
  };
  const scrollRef = useLegendListRef(listRef, updateScrollFade);
  // Kept rows re-render only when this changes, so it holds everything rows read besides their item.
  const rowInputs = {
    highlightedItemValue: props.highlightedItemValue,
    keybindings: props.keybindings,
  };

  if (props.rows.length === 0) {
    return <CommandPaletteEmptyState {...props} />;
  }

  return (
    <div
      ref={containerRef}
      className="relative flex max-h-[inherit] min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div ref={railRef} aria-hidden="true" inert data-slot="command-magnetic-rail" />
      <CommandListVirtualized>
        <LegendList<CommandPaletteRow>
          ref={scrollRef}
          data={props.rows}
          initialScrollOffset={0}
          keyExtractor={(row) => row.key}
          itemsAreEqual={commandPaletteRowsAreEqual}
          getItemType={(row) => row.kind}
          extraData={rowInputs}
          renderItem={({ item: row }) =>
            row.kind === "label" ? (
              <div className={row.first ? undefined : "pt-1.5"}>
                <CommandListHeading>{row.label}</CommandListHeading>
              </div>
            ) : row.itemIndex === null ? (
              <DisabledCommandPaletteResultRow item={row.item} />
            ) : (
              <CommandPaletteResultRow
                index={row.itemIndex}
                item={row.item}
                keybindings={props.keybindings}
                isActive={props.highlightedItemValue === row.item.value}
                onExecuteItem={onExecuteItem}
              />
            )
          }
          estimatedItemSize={40}
          drawDistance={400}
          onLayout={updateScrollFade}
          onScroll={updateScrollFade}
          onReady={updateScrollFade}
          // Legend counts style padding (not class padding) in its size, end state and row positions.
          style={{ paddingTop: 8, paddingBottom: 8 }}
          contentContainerClassName="px-2"
          className={cn(
            "min-h-0 scroll-py-6 overflow-x-hidden overscroll-y-contain [&::-webkit-scrollbar-track]:my-2",
            getVirtualizedScrollFadeClassName(scrollFade),
          )}
        />
      </CommandListVirtualized>
    </div>
  );
}

export function CommandPaletteTitleIcon(props: { children: ReactNode }) {
  return <span className="flex h-5 shrink-0 items-center self-start pt-0.5">{props.children}</span>;
}

function CommandPaletteTitle({
  item,
}: {
  item: Pick<CommandPaletteActionItem | CommandPaletteSubmenuItem, "title">;
}) {
  const { title } = item;
  return (
    <span className="truncate" dir={typeof title === "string" ? textDirection(title) : undefined}>
      {title}
    </span>
  );
}

/**
 * Project and environment for a thread row whose second line shows a message
 * snippet or match hint instead, so similar rows can still be told apart.
 */
function ThreadRowContext({
  item,
}: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  if (!item.threadSearch || !(item.threadContentMatch || item.matchHint)) return null;
  // A "Project: …" hint already names the project.
  const context = [item.threadSearch.projectTitle, item.threadSearch.environmentLabel]
    .filter((part) => part && part !== item.matchHint?.text)
    .join(" · ");
  return context ? (
    <span className="max-w-[45%] shrink-0 truncate text-muted-foreground/70 text-xs">
      {context}
    </span>
  ) : null;
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-base opacity-64 sm:min-h-7 sm:text-sm">
      <CommandPaletteTitleIcon>{props.item.icon}</CommandPaletteTitleIcon>
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <CommandPaletteTitle item={props.item} />
            <ThreadRowContext item={props.item} />
          </span>
          {props.item.threadContentMatch ? (
            <ThreadSearchMatchExcerpt match={props.item.threadContentMatch} />
          ) : props.item.matchHint ? (
            <SearchMatchHintLine hint={props.item.matchHint} />
          ) : props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-xs">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <CommandPaletteTitle item={props.item} />
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  index?: number;
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      {...(props.index === undefined ? {} : { index: props.index })}
      value={props.item.value}
      active={props.isActive}
      {...(props.item.kind === "action" && props.item.checked !== undefined
        ? { "aria-checked": props.item.checked }
        : {})}
      onPointerDown={(event) => {
        if (props.item.threadRef) {
          startPaletteThreadDrag(
            event.nativeEvent,
            props.item.threadRef,
            props.item.searchTitle ??
              (typeof props.item.title === "string" ? props.item.title : "Thread"),
          );
        }
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      <CommandPaletteTitleIcon>{props.item.icon}</CommandPaletteTitleIcon>
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <CommandPaletteTitle item={props.item} />
            <ThreadRowContext item={props.item} />
          </span>
          {props.item.threadContentMatch ? (
            <ThreadSearchMatchExcerpt match={props.item.threadContentMatch} />
          ) : props.item.matchHint ? (
            <SearchMatchHintLine hint={props.item.matchHint} />
          ) : props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-xs">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <CommandPaletteTitle item={props.item} />
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.kind === "action" && props.item.pin ? (
        <ProjectPinButton
          name={props.item.pin.name}
          pinned={props.item.pin.pinned}
          onToggle={props.item.pin.toggle}
          shortcutLabel={shortcutLabelForCommand(props.keybindings, "thread.pin")}
        />
      ) : null}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-(--ease-drawer) motion-safe:in-data-selected:translate-x-0.5 motion-safe:in-data-highlighted:translate-x-0.5 motion-safe:in-data-active:translate-x-0.5 motion-reduce:transition-none" />
      ) : null}
    </CommandItem>
  );
}
