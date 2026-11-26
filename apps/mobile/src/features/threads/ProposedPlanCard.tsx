import { useAtomValue } from "@effect/atom-react";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { useGT } from "gt-react-native";
import { m } from "../../i18n/messages";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useDeadlinePassed } from "../../lib/clock";
import { cn } from "../../lib/cn";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_EFFECTS_FAST, SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { CopyTextButton } from "./CopyTextButton";

const SAVED_FEEDBACK_DURATION_MS = 2400;
const SAVED_BADGE_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const SAVED_BADGE_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const PLAN_LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(26)
  .stiffness(360)
  .mass(0.75)
  .reduceMotion(ReduceMotion.System);
const PLAN_CHECKBOX_PATTERN = /^[-*]\s+\[([ xX])\]\s+(.+)$/gm;

interface ParsedPlanStep {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
}

function parsePlanChecklist(markdown: string): ReadonlyArray<ParsedPlanStep> {
  const steps: ParsedPlanStep[] = [];
  PLAN_CHECKBOX_PATTERN.lastIndex = 0;
  let match = PLAN_CHECKBOX_PATTERN.exec(markdown);
  let index = 0;
  while (match !== null) {
    const label = (match[2] ?? "").trim();
    if (label.length > 0) {
      steps.push({
        id: `${index}:${label}`,
        label,
        checked: (match[1] ?? "").toLowerCase() === "x",
      });
      index += 1;
    }
    match = PLAN_CHECKBOX_PATTERN.exec(markdown);
  }
  return steps;
}

function PlanStepCheckChip(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePress = () => {
    scale.set(
      withSequence(
        withSpring(0.94, SPRING_EFFECTS_FAST),
        withSpring(1.03, SPRING_EFFECTS_FAST),
        withSpring(1, SPRING_EFFECTS_FAST),
      ),
    );
    props.onToggle();
  };

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.checked }}
        onPress={handlePress}
        className={cn(
          "min-h-9 flex-row items-center gap-2 rounded-xl border px-3 py-1.5 active:opacity-75",
          props.checked ? "border-primary/40 bg-primary/10" : "border-border bg-input",
        )}
      >
        <View
          className={cn(
            "size-4 items-center justify-center rounded border",
            props.checked ? "border-primary bg-primary" : "border-foreground-muted/50",
          )}
        >
          {props.checked ? (
            <SymbolView
              name="checkmark"
              size={10}
              weight="bold"
              tintColorClassName="accent-primary-foreground"
              type="monochrome"
            />
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          className={cn(
            "min-w-0 flex-1 text-xs",
            props.checked ? "text-foreground-muted line-through" : "text-foreground",
          )}
        >
          {props.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function ProposedPlanCard(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null | undefined;
  readonly markdown: string;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const gt = useGT();
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(props.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [stepOverrides, setStepOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const savedFeedbackEnded = useDeadlinePassed(
    savedAtMs === null ? null : savedAtMs + SAVED_FEEDBACK_DURATION_MS,
  );
  const recentlySaved = savedAtMs !== null && !savedFeedbackEnded;
  const [lastPath, setLastPath] = useState("plan.md");
  const contents = `${props.markdown.trimEnd()}\n`;
  const title = proposedPlanTitle(props.markdown) ?? gt("Proposed plan");

  const parsedSteps = useMemo(() => parsePlanChecklist(props.markdown), [props.markdown]);
  const completedStepCount = parsedSteps.reduce(
    (count, step) => count + ((stepOverrides[step.id] ?? step.checked) ? 1 : 0),
    0,
  );
  const progressFraction = parsedSteps.length > 0 ? completedStepCount / parsedSteps.length : 0;
  const progressValue = useSharedValue(progressFraction);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the spring progress bar fill when checklist completion changes
  useEffect(() => {
    progressValue.set(withSpring(progressFraction, SPRING_SPATIAL_SNAPPY));
  }, [progressFraction, progressValue]);

  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${Math.round(Math.max(0, Math.min(1, progressValue.get())) * 100)}%`,
  }));

  const dragOffsetY = useSharedValue(0);
  const toggleCollapsedFromGesture = useCallback((nextCollapsed: boolean) => {
    triggerSemanticHaptic(nextCollapsed ? "toggleOff" : "toggleOn");
    setCollapsed(nextCollapsed);
  }, []);

  const headerPanGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onUpdate((event) => {
          const clamped = collapsed
            ? Math.max(-36, Math.min(0, event.translationY))
            : Math.max(0, Math.min(84, event.translationY));
          dragOffsetY.set(clamped);
        })
        .onEnd((event) => {
          dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          if (!collapsed && (event.translationY > 36 || event.velocityY > 480)) {
            runOnJS(toggleCollapsedFromGesture)(true);
          } else if (collapsed && (event.translationY < -24 || event.velocityY < -420)) {
            runOnJS(toggleCollapsedFromGesture)(false);
          }
        })
        .onFinalize(() => {
          if (dragOffsetY.get() !== 0) {
            dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          }
        }),
    [collapsed, dragOffsetY, toggleCollapsedFromGesture],
  );

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragOffsetY.get() }],
  }));

  const save = async (path: string) => {
    const relativePath = path.trim();
    if (!canWrite || !props.workspaceRoot || inFlight.current) return;
    if (!relativePath) {
      triggerSemanticHaptic("reject");
      Dialog.alert(gt("Enter a workspace path"));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setLastPath(relativePath);
    const result = await writeFile({
      environmentId: props.environmentId,
      input: { cwd: props.workspaceRoot, relativePath, contents },
    }).finally(() => {
      inFlight.current = false;
      setSaving(false);
    });
    if (result._tag === "Success") {
      setSavedAtMs(Date.now());
      triggerSemanticHaptic("confirm");
    } else if (!isAtomCommandInterrupted(result)) {
      triggerSemanticHaptic("reject");
      const error = squashAtomCommandFailure(result);
      Dialog.alert(gt("Could not save plan"), errorDisplayMessage(error, m) ?? String(error));
    }
  };

  return (
    <Animated.View
      layout={PLAN_LAYOUT_TRANSITION}
      style={dragStyle}
      className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4"
    >
      <GestureDetector gesture={headerPanGesture}>
        <View className="-mx-2 -mt-2 gap-1.5 px-2 pt-1">
          <View className="items-center">
            <View className="h-1 w-9 rounded-full bg-foreground-muted/30" />
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !collapsed }}
              accessibilityLabel={
                collapsed ? gt("Expand proposed plan") : gt("Collapse proposed plan")
              }
              onPress={() => toggleCollapsedFromGesture(!collapsed)}
              className="min-h-8 flex-1 flex-row items-center gap-2 active:opacity-75"
            >
              <Text
                accessibilityRole="header"
                numberOfLines={collapsed ? 1 : 2}
                className="min-w-0 flex-1 font-t3-bold text-base text-foreground"
              >
                {title}
              </Text>
              {parsedSteps.length > 0 ? (
                <Text className="font-t3-medium text-xs tabular-nums text-foreground-muted">
                  {`${completedStepCount}/${parsedSteps.length}`}
                </Text>
              ) : null}
              <SymbolView
                name={collapsed ? "chevron.down" : "chevron.up"}
                size={12}
                tintColorClassName="accent-icon-subtle"
                type="monochrome"
              />
            </Pressable>
            <CopyTextButton accessibilityLabel={gt("Copy plan")} text={contents} />
          </View>
        </View>
      </GestureDetector>

      {parsedSteps.length > 0 ? (
        <View className="gap-2">
          <View className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
            <Animated.View className="h-full rounded-full bg-primary" style={progressFillStyle} />
          </View>
          {!collapsed ? (
            <View className="gap-1.5">
              {parsedSteps.map((step) => {
                const checked = stepOverrides[step.id] ?? step.checked;
                return (
                  <PlanStepCheckChip
                    key={step.id}
                    label={step.label}
                    checked={checked}
                    onToggle={() => {
                      triggerSemanticHaptic("segmentTick");
                      setStepOverrides((prev) => ({ ...prev, [step.id]: !checked }));
                    }}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {!collapsed ? (
        <>
          {props.renderMarkdown(stripDisplayedPlanMarkdown(props.markdown))}
          <View className="flex-row items-center gap-3">
            <Button
              label={saving ? gt("Saving...") : gt("Save to workspace")}
              tone="secondary"
              loading={saving}
              disabled={!canWrite || !props.workspaceRoot || saving}
              onPress={() =>
                Dialog.prompt({
                  title: gt("Save plan to workspace"),
                  // The write replaces an existing file, and the RPC has no create-only mode.
                  message: gt(
                    "Enter a path relative to the thread's workspace. A file already at that path is replaced.",
                  ),
                  initialValue: lastPath,
                  confirmText: gt("Save", { $context: "verb, confirm button" }),
                  onConfirm: (path) => void save(path),
                })
              }
            />
            {recentlySaved ? (
              <Animated.View
                entering={SAVED_BADGE_ENTERING}
                exiting={SAVED_BADGE_EXITING}
                accessibilityLiveRegion="polite"
                className="flex-row items-center gap-1.5"
              >
                <SymbolView
                  name="checkmark.circle.fill"
                  size={15}
                  tintColorClassName="accent-adaptive-emerald-600-400"
                  type="monochrome"
                />
                <Text className="font-t3-medium text-xs text-adaptive-emerald-700-300">
                  {gt("Saved")}
                </Text>
              </Animated.View>
            ) : null}
          </View>
        </>
      ) : null}
    </Animated.View>
  );
}
