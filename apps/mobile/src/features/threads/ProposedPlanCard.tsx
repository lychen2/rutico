import { useAtomValue } from "@effect/atom-react";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { m } from "../../i18n/messages";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useDeadlinePassed } from "../../lib/clock";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { CopyTextButton } from "./CopyTextButton";

const SAVED_FEEDBACK_DURATION_MS = 2400;
const SAVED_BADGE_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const SAVED_BADGE_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

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
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const savedFeedbackEnded = useDeadlinePassed(
    savedAtMs === null ? null : savedAtMs + SAVED_FEEDBACK_DURATION_MS,
  );
  const recentlySaved = savedAtMs !== null && !savedFeedbackEnded;
  const [lastPath, setLastPath] = useState("plan.md");
  const contents = `${props.markdown.trimEnd()}\n`;

  const save = async (path: string) => {
    const relativePath = path.trim();
    if (!canWrite || !props.workspaceRoot || inFlight.current) return;
    if (!relativePath) {
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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(gt("Could not save plan"), errorDisplayMessage(error, m) ?? String(error));
    }
  };

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="flex-row items-center gap-2">
        <Text accessibilityRole="header" className="flex-1 font-t3-bold text-base text-foreground">
          {proposedPlanTitle(props.markdown) ?? gt("Proposed plan")}
        </Text>
        <CopyTextButton accessibilityLabel={gt("Copy plan")} text={contents} />
      </View>
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
    </View>
  );
}
