import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { LegendList } from "@legendapp/list/react-native";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AppBar } from "../../components/ui/AppBar";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { ReviewSectionItem } from "./reviewModel";
import { useReviewHeaderPresentation } from "./useReviewHeaderPresentation";
import * as Haptics from "expo-haptics";
import { T, useGT, Var } from "gt-react-native";
import { type Ref, type ReactElement, useImperativeHandle, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotionEnabled } from "../../lib/appState";
import { useContentTopInset, useSheetContentBottomInset } from "../../components/ui/useBarInset";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SymbolView } from "../../components/ui/AppSymbol";
import {
  ContentBand,
  ContentStatus,
  contentStatusContainerStyle,
} from "../../components/ui/ContentBand";
import { PaneListItem } from "../../components/ui/PaneListItem";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetPane } from "../../components/ui/SheetPane";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useThreadDraftForThread } from "../../state/use-thread-composer-state";
import { EnvironmentConnectionNotice } from "../connection/EnvironmentConnectionNotice";
import { useRetryEnvironment } from "../connection/useRetryEnvironment";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  Inspector,
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useReviewCacheForThread } from "./reviewState";
import {
  isNativeReviewDiffDrawEvent,
  type NativeReviewDiffViewHandle,
  resolveNativeReviewDiffView,
} from "../diffs/nativeReviewDiffSurface";
import { NATIVE_REVIEW_DIFF_CONTENT_WIDTH } from "./nativeReviewDiffAdapter";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";
import { useReviewDiffData } from "./useReviewDiffData";
import { useReviewDiffPrewarming } from "./useReviewDiffPrewarming";
import { useReviewFileVisibility } from "./reviewFileVisibility";
import { useReviewSections } from "./useReviewSections";
import { useNativeReviewDiffBridge } from "./useNativeReviewDiffBridge";
import { useReviewCommentSelectionController } from "./useReviewCommentSelectionController";
import { resolveReviewAvailability } from "./reviewAvailability";
import { resolveSelectedReviewFileId } from "./reviewPaneSelection";
import { buildReviewSectionMenu } from "./review-section-menu";
import { computeViewedProgressRing } from "./reviewNavigatorHud";
import { reportShowcaseSceneRendered } from "../showcase/showcaseRenderSignal";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import type { usePullRequestFileFilter } from "../pull-requests/usePullRequestFileFilter";

function ReviewHeader(
  props: Parameters<typeof useReviewHeaderPresentation>[0] & {
    readonly sectionMenu: ReturnType<typeof buildReviewSectionMenu>;
    readonly showSectionToolbar: boolean;
    readonly showChangedFilesToggle: boolean;
    readonly selectedRepositoryKey: string | null;
    readonly onSelectRepository: (key: string | null) => void;
    readonly fileFilter: ReturnType<typeof usePullRequestFileFilter>;
    readonly onSelectSection: (sectionId: string) => void;
    readonly onReturnToThread: () => void;
  },
) {
  const { toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const presentation = useReviewHeaderPresentation(props);
  const gt = useGT();
  const sectionAction = (section: ReviewSectionItem | null, title: string): AppBarMenuItem => ({
    id: section ? `section:${section.id}` : `unavailable:${title}`,
    title,
    disabled: section === null,
    selected: section !== null && section.id === props.selectedSection?.id,
    onPress: () => {
      if (section) props.onSelectSection(section.id);
    },
  });
  return (
    <AppBar
      title={presentation.title}
      subtitle={presentation.subtitle}
      onBack={props.onReturnToThread}
      hideBottomBorder
      backInSplitView={{ accessibilityLabel: gt("Back to chat"), icon: "chevron.left" }}
      actions={
        props.showChangedFilesToggle
          ? [
              {
                accessibilityLabel: panes.auxiliaryPaneVisible
                  ? gt("Hide changed files")
                  : gt("Show changed files"),
                icon: "sidebar.right",
                selected: panes.auxiliaryPaneVisible,
                onPress: toggleAuxiliaryPane,
              },
            ]
          : undefined
      }
      menus={[
        ...(presentation.gitMenu ? [presentation.gitMenu] : []),
        ...(props.showSectionToolbar
          ? [
              {
                title: gt("Select diff"),
                icon: presentation.menuIcon,
                items: [
                  {
                    id: "sections",
                    inline: true,
                    items: [
                      sectionAction(
                        props.sectionMenu.branchChanges,
                        gt("Changes", { $context: "diff section: branch changes" }),
                      ),
                      sectionAction(
                        props.sectionMenu.workingTree,
                        gt("Uncommitted", { $context: "diff section: working tree" }),
                      ),
                      sectionAction(props.sectionMenu.latestTurn, gt("Latest turn")),
                    ],
                  },
                  {
                    id: "files",
                    inline: true,
                    items: [
                      {
                        id: "hide-tests",
                        title: gt("Hide test files"),
                        icon: "line.3.horizontal.decrease",
                        selected: props.fileFilter.hideTestFiles,
                        onPress: props.fileFilter.toggle,
                      },
                    ],
                  },
                  ...(props.sectionMenu.turns.length > 0
                    ? [
                        {
                          id: "turns",
                          title: gt("Turn", { $context: "agent turn, diff section menu" }),
                          items: props.sectionMenu.turns.map((section) => ({
                            id: `section:${section.id}`,
                            title: section.title,
                            subtitle: section.subtitle ?? undefined,
                            selected: section.id === props.selectedSection?.id,
                            onPress: () => props.onSelectSection(section.id),
                          })),
                        },
                      ]
                    : []),
                  ...(props.selectedSection?.repositoryGroups
                    ? [
                        {
                          id: "repositories",
                          title: gt("Repository"),
                          items: [
                            {
                              id: "repository:all",
                              title: gt("All repositories"),
                              selected: props.selectedRepositoryKey === null,
                              onPress: () => props.onSelectRepository(null),
                            },
                            ...props.selectedSection.repositoryGroups.map((group) => ({
                              id: `repository:${group.key}`,
                              title: group.name,
                              subtitle: group.relativePath || undefined,
                              selected: group.key === props.selectedRepositoryKey,
                              onPress: () => props.onSelectRepository(group.key),
                            })),
                          ],
                        },
                      ]
                    : []),
                  ...(presentation.refreshAction ? [presentation.refreshAction] : []),
                ],
              },
            ]
          : []),
      ]}
    />
  );
}

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

const ReviewNotice = function ReviewNotice(props: { readonly notice: string }) {
  return (
    <ContentBand tone="warning">
      <Text className="text-xs font-t3-bold uppercase text-warning-foreground">
        <T>Partial diff</T>
      </Text>
      <Text className="text-xs leading-normal text-warning-foreground">{props.notice}</Text>
    </ContentBand>
  );
};

function ReviewSelectionActionBar(props: {
  readonly bottomInset: number;
  readonly title: string | null;
  readonly onOpenComment: (() => void) | null;
  readonly onClear: () => void;
}) {
  if (!props.title) {
    return null;
  }

  const content = (
    <>
      <SymbolView
        name={props.onOpenComment ? "text.bubble" : "line.3.horizontal.decrease.circle"}
        size={16}
        tintColorClassName="accent-primary-foreground"
        type="monochrome"
      />
      <Text className="text-base font-t3-bold text-primary-foreground">{props.title}</Text>
    </>
  );

  return (
    <Animated.View
      entering={FadeInDown.springify().reduceMotion(ReduceMotion.System)}
      exiting={FadeOutDown.duration(150).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        bottom: Math.max(props.bottomInset, 10) + 18,
        flexDirection: "row",
        justifyContent: "center",
        gap: 10,
      }}
    >
      {props.onOpenComment ? (
        <Pressable
          className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary px-5"
          onPress={props.onOpenComment}
        >
          {content}
        </Pressable>
      ) : (
        <View className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary px-5">
          {content}
        </View>
      )}

      <Pressable
        className="h-12 w-12 items-center justify-center rounded-full bg-primary"
        onPress={props.onClear}
      >
        <SymbolView
          name="xmark"
          size={16}
          tintColorClassName="accent-primary-foreground"
          type="monochrome"
        />
      </Pressable>
    </Animated.View>
  );
}

const HUD_RING_SIZE = 22;
const HUD_RING_STROKE = 2.5;
const HUD_RING_RADIUS = (HUD_RING_SIZE - HUD_RING_STROKE) / 2;

function ReviewDiffNavigatorHud(props: {
  readonly bottomInset: number;
  readonly viewedCount: number;
  readonly totalCount: number;
  readonly ringTrackColor: string;
  readonly ringFillColor: string;
  readonly onPrevHunk: () => void;
  readonly onNextHunk: () => void;
}) {
  const gt = useGT();
  const ring = computeViewedProgressRing(props.viewedCount, props.totalCount, HUD_RING_RADIUS);

  return (
    <Animated.View
      entering={FadeInDown.duration(180).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutDown.duration(140).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: Math.max(props.bottomInset, 10) + 14,
        alignItems: "center",
      }}
    >
      <View
        className="flex-row items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1.5 py-1"
        style={{ elevation: 4 }}
      >
        <View
          accessible
          accessibilityLabel={gt("{viewed} of {total} files viewed", {
            viewed: ring.viewed,
            total: ring.total,
          })}
          className="flex-row items-center gap-2 pr-1.5"
        >
          <Svg width={HUD_RING_SIZE} height={HUD_RING_SIZE}>
            <Circle
              cx={HUD_RING_SIZE / 2}
              cy={HUD_RING_SIZE / 2}
              r={HUD_RING_RADIUS}
              stroke={props.ringTrackColor}
              strokeWidth={HUD_RING_STROKE}
              fill="none"
            />
            <Circle
              cx={HUD_RING_SIZE / 2}
              cy={HUD_RING_SIZE / 2}
              r={HUD_RING_RADIUS}
              stroke={props.ringFillColor}
              strokeWidth={HUD_RING_STROKE}
              strokeDasharray={`${ring.circumference} ${ring.circumference}`}
              strokeDashoffset={ring.strokeDashoffset}
              strokeLinecap="round"
              fill="none"
              rotation={-90}
              origin={`${HUD_RING_SIZE / 2}, ${HUD_RING_SIZE / 2}`}
            />
          </Svg>
          <Text className="font-mono text-xs font-t3-semibold tabular-nums text-foreground">
            {`${ring.viewed}/${ring.total}`}
          </Text>
        </View>
        <View className="h-5 w-px bg-border" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Previous hunk")}
          hitSlop={4}
          onPress={props.onPrevHunk}
          className="size-10 items-center justify-center rounded-full active:bg-primary/15"
        >
          <SymbolView
            name="chevron.up"
            size={15}
            tintColorClassName="accent-foreground"
            type="monochrome"
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Next hunk")}
          hitSlop={4}
          onPress={props.onNextHunk}
          className="size-10 items-center justify-center rounded-full active:bg-primary/15"
        >
          <SymbolView
            name="chevron.down"
            size={15}
            tintColorClassName="accent-foreground"
            type="monochrome"
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

interface ReviewNavigatorFile {
  readonly id: string;
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

const ReviewFileNavigatorRow = function ReviewFileNavigatorRow(props: {
  readonly file: ReviewNavigatorFile;
  readonly selected: boolean;
  readonly onSelectFile: (fileId: string | null) => void;
}) {
  const { file, selected, onSelectFile } = props;
  const handlePress = () => {
    onSelectFile(selected ? null : file.id);
  };

  return (
    <PaneListItem selected={selected} onPress={handlePress}>
      <Text
        className={
          selected
            ? "text-xs font-t3-bold text-foreground"
            : "text-xs font-t3-medium text-foreground-secondary"
        }
        numberOfLines={2}
      >
        {file.path}
      </Text>
      <View className="mt-1 flex-row gap-2">
        <Text className="text-2xs font-t3-bold text-adaptive-emerald-700-300">
          +{formatDiffCount(file.additions)}
        </Text>
        <Text className="text-2xs font-t3-bold text-adaptive-rose-700-300">
          -{formatDiffCount(file.deletions)}
        </Text>
      </View>
    </PaneListItem>
  );
};

interface ReviewFileNavigatorHandle {
  readonly setVisibleFile: (fileId: string | null) => void;
}

interface ReviewFileNavigatorProps {
  readonly files: ReadonlyArray<ReviewNavigatorFile>;
  readonly sectionId: string | null;
  readonly onSelectFile: (fileId: string | null) => void;
  readonly ref?: Ref<ReviewFileNavigatorHandle>;
}

function ReviewFileNavigator({ files, sectionId, onSelectFile, ref }: ReviewFileNavigatorProps) {
  const [fileSelection, setFileSelection] = useState<{
    readonly sectionId: string | null;
    readonly fileId: string | null;
  }>({ sectionId: null, fileId: null });
  const availableFileIds = files.map((file) => file.id);
  const selectedFileId = resolveSelectedReviewFileId({
    selection: fileSelection,
    sectionId,
    availableFileIds,
  });

  useImperativeHandle(
    ref,
    () => ({
      setVisibleFile: (fileId) => {
        if (fileId !== null && !availableFileIds.includes(fileId)) {
          return;
        }
        setFileSelection((current) => {
          if (current.sectionId === sectionId && current.fileId === fileId) {
            return current;
          }
          return { sectionId, fileId };
        });
      },
    }),
    [availableFileIds, sectionId],
  );

  const handleSelectFile = (fileId: string | null) => {
    setFileSelection({ sectionId, fileId });
    onSelectFile(fileId);
  };
  const gt = useGT();

  const renderFile = ({ item }: { readonly item: ReviewNavigatorFile }) => (
    <ReviewFileNavigatorRow
      file={item}
      selected={selectedFileId === item.id}
      onSelectFile={handleSelectFile}
    />
  );

  return (
    <SheetPane>
      <AppBar
        title={gt("Changed files")}
        subtitle={gt("{count, plural, one {{count} file} other {{count} files}}", {
          count: files.length,
        })}
        hideBottomBorder
      />
      <ScreenContent insetHorizontal>
        <LegendList
          renderScrollComponent={NativeScrollView}
          data={files}
          // Rows keep their callback until extraData changes; it reads collapsed files.
          extraData={[selectedFileId, handleSelectFile]}
          keyExtractor={(file) => file.id}
          estimatedItemSize={64}
          recycleItems
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
          renderItem={renderFile}
        />
      </ScreenContent>
    </SheetPane>
  );
}

type ReviewSheetProps = StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}>;

export function ReviewSheet(props: ReviewSheetProps) {
  const gt = useGT();
  const reduceMotion = useReduceMotionEnabled();
  const { nativeReviewDiffStyle } = useAppearanceCodeSurface();
  const { panes } = useWorkspacePaneState();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const insets = useSafeAreaInsets();
  const { themeAppearance: selectedTheme, themeVariables } = useAppearancePreferences();
  const { environmentId, threadId } = props.route.params;
  const environment = useEnvironmentPresentation(environmentId);
  const retryEnvironment = useRetryEnvironment();
  const isEnvironmentReady = environment.presentation?.connection.phase === "connected";
  const { draftMessage, draftContext } = useThreadDraftForThread({ environmentId, threadId });
  const reviewCache = useReviewCacheForThread({ environmentId, threadId });
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const topContentInset = useContentTopInset();
  const bottomContentInset = useSheetContentBottomInset();

  const {
    error,
    reviewSections,
    selectedSection,
    refreshSelectedSection,
    selectSection,
    isSelectedSectionPending,
  } = useReviewSections({
    enabled: isEnvironmentReady,
    environmentId,
    threadId,
    reviewCache,
  });
  useReviewDiffPrewarming({
    threadKey: reviewCache.threadKey,
    sections: reviewSections,
    selectedSectionId: selectedSection?.id ?? null,
  });
  const [repositorySelection, setRepositorySelection] = useState<{
    readonly sectionId: string;
    readonly key: string;
  } | null>(null);
  const repositoryGroups = selectedSection?.repositoryGroups;
  const selectedRepository =
    repositorySelection !== null && repositorySelection.sectionId === selectedSection?.id
      ? (repositoryGroups?.find((group) => group.key === repositorySelection.key) ?? null)
      : null;
  const {
    headerDiffSummary,
    nativeReviewDiffData,
    parsedDiff,
    allFiles,
    fileFilter,
    pendingReviewCommentCount,
    sectionFiles,
    loadVisibleFile,
    isPending: areFilePatchesPending,
  } = useReviewDiffData({
    threadKey: reviewCache.threadKey,
    environmentId,
    cwd: selectedThreadCwd,
    selectedSection,
    draftMessage,
    draftContext,
    repositoryFilter:
      selectedRepository === null || repositoryGroups === undefined
        ? null
        : {
            folder: selectedRepository.relativePath,
            folders: repositoryGroups.map((group) => group.relativePath).join("\0"),
          },
  });
  // Expo may return null before registration or in older binaries; use the fallback.
  const NativeReviewDiffView = resolveNativeReviewDiffView();
  const nativeReviewDiffViewRef = useRef<NativeReviewDiffViewHandle>(null);
  const showcasedReviewDrawRef = useRef<string | null>(null);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handlePullToRefresh = async () => {
    setIsPullRefreshing(true);
    await refreshSelectedSection();
    setIsPullRefreshing(false);
  };
  const isRefreshing = isPullRefreshing || isSelectedSectionPending || areFilePatchesPending;
  // A refresh that starts programmatically adds its height to the native top inset and
  // subtracts it when it ends. If topContentInset changes in between, the inset ends up
  // short and the content sits under the header, so the fallback ScrollView starts over.
  const [fallbackInset, setFallbackInset] = useState(topContentInset);
  const [fallbackScrollViewKey, setFallbackScrollViewKey] = useState(0);
  if (fallbackInset !== topContentInset) {
    setFallbackInset(topContentInset);
    if (isRefreshing) setFallbackScrollViewKey((key) => key + 1);
  }
  const reviewFileNavigatorRef = useRef<ReviewFileNavigatorHandle>(null);
  const reviewFiles = parsedDiff.kind === "files" ? parsedDiff.files : [];
  // Hidden files keep their viewed and expanded state for when they are shown again.
  const fileVisibility = useReviewFileVisibility({
    threadKey: reviewCache.threadKey,
    sectionId: selectedSection?.id ?? null,
    files: allFiles,
    sectionFiles,
    cachedExpandedFileIds: selectedSection?.id
      ? reviewCache.expandedFileIdsBySection[selectedSection.id]
      : undefined,
    cachedViewedFileIds: selectedSection?.id
      ? reviewCache.viewedFileIdsBySection[selectedSection.id]
      : undefined,
  });
  const { collapsedFileIds, toggleExpandedFile, toggleViewedFile, viewedFileIds } = fileVisibility;
  const commentSelection = useReviewCommentSelectionController({
    environmentId,
    threadId,
    selectedSection,
    nativeReviewDiffData,
  });
  const reviewContentKey = selectedSection
    ? `${selectedSection.id}:${selectedRepository?.key ?? ""}`
    : null;
  const nativeBridge = useNativeReviewDiffBridge({
    threadKey: reviewCache.threadKey,
    sectionId: reviewContentKey,
    diff: selectedSection?.diff,
    data: nativeReviewDiffData,
    collapsedFileIds,
    viewedFileIds,
    selectedRowIds: commentSelection.selectedRowIds,
    canHighlight: parsedDiff.kind === "files",
  });
  const showcaseReviewKey =
    SHOWCASE_ENABLED && parsedDiff.kind === "files" && selectedSection
      ? `${reviewCache.threadKey}:${selectedSection.id}:${nativeBridge.tokensResetKey}:${nativeBridge.themeId}`
      : null;
  const handleNativeDebug = (event: NativeSyntheticEvent<Record<string, unknown>>) => {
    nativeBridge.onDebug(event);
    if (
      showcaseReviewKey === null ||
      showcasedReviewDrawRef.current === showcaseReviewKey ||
      !isNativeReviewDiffDrawEvent(event.nativeEvent)
    ) {
      return;
    }
    showcasedReviewDrawRef.current = showcaseReviewKey;
    reportShowcaseSceneRendered({ scene: "review", themeId: nativeBridge.themeId });
  };

  const handleSelectRepository = (key: string | null) => {
    commentSelection.clearSelection();
    setRepositorySelection(
      key === null || !selectedSection ? null : { sectionId: selectedSection.id, key },
    );
  };
  const handleSelectFile = async (fileId: string | null) => {
    loadVisibleFile(fileId, true);
    commentSelection.clearSelection();
    if (fileId !== null && collapsedFileIds.includes(fileId)) {
      toggleExpandedFile(fileId);
    }
    const nativeView = nativeReviewDiffViewRef.current;
    if (!nativeView) return;
    const result = await settlePromise(() =>
      fileId === null
        ? nativeView.scrollToTop(!reduceMotion)
        : nativeView.scrollToFile(fileId, !reduceMotion),
    );
    if (AsyncResult.isFailure(result)) {
      console.error("[review] Failed to navigate to diff file", squashAtomCommandFailure(result));
    }
  };
  const handleVisibleFileChange = (
    event: NativeSyntheticEvent<{ readonly fileId?: string | null }>,
  ) => {
    loadVisibleFile(event.nativeEvent.fileId ?? null);
    reviewFileNavigatorRef.current?.setVisibleFile(event.nativeEvent.fileId ?? null);
  };
  const renderInspector = () => (
    <ReviewFileNavigator
      ref={reviewFileNavigatorRef}
      files={nativeReviewDiffData.files}
      sectionId={selectedSection?.id ?? null}
      onSelectFile={(fileId) => void handleSelectFile(fileId)}
    />
  );

  const handleNativeToggleFile = (event: NativeSyntheticEvent<{ readonly fileId?: string }>) => {
    const { fileId } = event.nativeEvent;
    if (fileId) {
      loadVisibleFile(fileId, true);
      toggleExpandedFile(fileId);
    }
  };

  const handleNativeToggleViewedFile = (
    event: NativeSyntheticEvent<{ readonly fileId?: string }>,
  ) => {
    const { fileId } = event.nativeEvent;
    if (fileId) {
      toggleViewedFile(fileId);
    }
  };

  const parsedDiffNotice =
    parsedDiff.kind === "files" || parsedDiff.kind === "raw" ? parsedDiff.notice : null;
  const hasCachedSelectedDiff = selectedSection?.diff != null;
  const hasAnyCachedDiff = reviewSections.some((section) => section.diff != null);
  const sectionMenu = buildReviewSectionMenu(reviewSections);
  const { showConnectionNotice, showSectionToolbar } = resolveReviewAvailability({
    hasEnvironmentPresentation: environment.isReady,
    isEnvironmentConnected: isEnvironmentReady,
    hasCachedSelectedDiff,
    hasAnyCachedDiff,
  });
  const handleRetryEnvironment = () => {
    void retryEnvironment(environmentId);
  };
  const handleReturnToThread = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    selectDetail({
      name: "Thread",
      params: { environmentId: String(environmentId), threadId: String(threadId) },
    });
  };
  const androidHeaderSubtitle = [
    selectedSection?.title,
    selectedRepository?.name,
    headerDiffSummary.additions,
    headerDiffSummary.deletions,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  const handleNavigateHunk = async (direction: -1 | 1) => {
    const scrollToHunk = nativeReviewDiffViewRef.current?.scrollToHunk;
    if (!scrollToHunk) return;
    const result = await settlePromise(() => scrollToHunk(direction, !reduceMotion));
    if (AsyncResult.isSuccess(result) && result.value) {
      if (Platform.OS === "android") {
        void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(
          () => undefined,
        );
      } else {
        void Haptics.selectionAsync().catch(() => undefined);
      }
    }
  };
  const visibleViewedFileCount = reviewFiles.reduce(
    (count, file) => count + (viewedFileIds.includes(file.id) ? 1 : 0),
    0,
  );
  const showChangedFilesPane =
    !showConnectionNotice &&
    selectedSection !== null &&
    parsedDiff.kind === "files" &&
    NativeReviewDiffView !== null;
  const showChangedFilesToggle = panes.supportsAuxiliaryPane && showChangedFilesPane;

  const allFilesHidden = reviewFiles.length === 0 && fileFilter.hiddenCount > 0;
  const showAndroidDiffNavigatorHud =
    Platform.OS === "android" &&
    showChangedFilesPane &&
    !allFilesHidden &&
    reviewFiles.length > 0 &&
    commentSelection.selectionAction === null;
  const listHeader = (() => {
    const children: ReactElement[] = [];

    if (error) {
      children.push(
        <ContentBand key="review-error">
          <Text className="text-sm font-t3-bold text-foreground">
            <T>Review unavailable</T>
          </Text>
          <Text className="text-xs leading-normal text-foreground-muted">{error}</Text>
        </ContentBand>,
      );
    }

    if (parsedDiffNotice) {
      children.push(<ReviewNotice key="review-notice" notice={parsedDiffNotice} />);
    }

    if (selectedSection?.unlistedRepositories) {
      children.push(
        <ContentBand key="review-unlisted-repositories">
          <Text className="text-xs leading-normal text-foreground-muted">
            <T>
              This turn's changes in <Var>{selectedSection.unlistedRepositories.join(", ")}</Var>{" "}
              cannot be listed.
            </T>
          </Text>
        </ContentBand>,
      );
    }

    if (allFilesHidden) {
      children.push(
        <EmptyState
          key="review-tests-hidden"
          title={gt("Only test files changed")}
          detail={gt("Test files are hidden from this review.")}
          action={
            <Button label={gt("Show test files")} tone="contrast" onPress={fileFilter.showAll} />
          }
          variant="plain"
        />,
      );
    }

    if (children.length === 0) {
      return null;
    }

    return <>{children}</>;
  })();
  const headerSubtitle = [
    selectedRepository?.name,
    headerDiffSummary.additions,
    headerDiffSummary.deletions,
    pendingReviewCommentCount > 0
      ? gt("{count, plural, one {{count} comment} other {{count} comments}}", {
          count: pendingReviewCommentCount,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerTitleText = selectedSection?.title ?? gt("Review changes");

  return (
    <>
      {showChangedFilesPane ? (
        <Inspector
          revealKey={`${environmentId}:${threadId}`}
          content={{ active: "changes", panes: [{ key: "changes", render: renderInspector }] }}
        />
      ) : null}
      <ReviewHeader
        environmentId={environmentId}
        threadId={threadId}
        title={headerTitleText}
        subtitle={headerSubtitle}
        androidSubtitle={androidHeaderSubtitle}
        selectedThreadCwd={selectedThreadCwd}
        sectionMenu={sectionMenu}
        selectedSection={selectedSection}
        showSectionToolbar={showSectionToolbar}
        showChangedFilesToggle={showChangedFilesToggle}
        selectedRepositoryKey={selectedRepository?.key ?? null}
        onSelectRepository={handleSelectRepository}
        fileFilter={fileFilter}
        onRefresh={handlePullToRefresh}
        onSelectSection={selectSection}
        onReturnToThread={handleReturnToThread}
      />

      <ScreenContent>
        <View className="flex-1 bg-sheet">
          {showConnectionNotice ? (
            <View className="flex-1" style={{ paddingTop: topContentInset }}>
              <EnvironmentConnectionNotice
                environmentLabel={
                  environment.presentation?.entry.target.label ??
                  gt("Environment", { $context: "fallback name for a server" })
                }
                connection={
                  environment.presentation?.connection ?? {
                    phase: "available",
                    error: null,
                    traceId: null,
                  }
                }
                resource="review"
                onRetry={handleRetryEnvironment}
              />
            </View>
          ) : selectedSection &&
            parsedDiff.kind === "files" &&
            NativeReviewDiffView &&
            !allFilesHidden ? (
            <View
              className="flex-1"
              style={{
                backgroundColor: nativeBridge.theme.background,
              }}
            >
              <View
                className="min-w-0 flex-1"
                style={listHeader ? { paddingTop: topContentInset } : undefined}
              >
                {listHeader}
                <View className="min-w-0 flex-1" collapsable={false}>
                  {/* oxlint-disable-next-line react/static-components -- The resolver returns a cached native component with stable identity. */}
                  <NativeReviewDiffView
                    collapsable={false}
                    testID="review-native-diff-view"
                    refreshing={
                      isPullRefreshing || isSelectedSectionPending || areFilePatchesPending
                    }
                    onPullToRefresh={() => void handlePullToRefresh()}
                    style={StyleSheet.absoluteFill}
                    appearanceScheme={selectedTheme}
                    collapsedFileIdsJson={nativeBridge.collapsedFileIdsJson}
                    collapsedCommentIdsJson={nativeBridge.collapsedCommentIdsJson}
                    contentResetKey={`${reviewCache.threadKey}:${reviewContentKey}`}
                    contentWidth={NATIVE_REVIEW_DIFF_CONTENT_WIDTH}
                    contentInsetTop={listHeader ? 0 : topContentInset}
                    contentInsetBottom={bottomContentInset}
                    nativeViewRef={nativeReviewDiffViewRef}
                    rowHeight={nativeReviewDiffStyle.rowHeight}
                    rowsJson={nativeBridge.rowsJson}
                    selectedRowIdsJson={nativeBridge.selectedRowIdsJson}
                    styleJson={nativeBridge.styleJson}
                    themeJson={nativeBridge.themeJson}
                    tokensPatchJson={nativeBridge.tokensPatchJson}
                    tokensResetKey={nativeBridge.tokensResetKey}
                    viewedFileIdsJson={nativeBridge.viewedFileIdsJson}
                    onDebug={handleNativeDebug}
                    onPressLine={commentSelection.onPressLine}
                    onVisibleFileChange={handleVisibleFileChange}
                    onToggleComment={nativeBridge.onToggleComment}
                    onToggleFile={handleNativeToggleFile}
                    onToggleViewedFile={handleNativeToggleViewedFile}
                  />
                </View>
              </View>
            </View>
          ) : (
            <ScrollView
              key={fallbackScrollViewKey}
              contentContainerStyle={
                parsedDiff.kind === "empty" || !selectedSection
                  ? contentStatusContainerStyle
                  : undefined
              }
              contentInsetAdjustmentBehavior="never"
              contentInset={{ top: topContentInset, bottom: bottomContentInset }}
              contentOffset={{ x: 0, y: -topContentInset }}
              automaticallyAdjustsScrollIndicatorInsets={false}
              scrollIndicatorInsets={{ top: topContentInset, bottom: bottomContentInset }}
              showsVerticalScrollIndicator={false}
              className="flex-1"
              refreshControl={
                // Fallback and empty states need refresh controls; only Android has an explicit refresh menu.
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => void handlePullToRefresh()}
                />
              }
            >
              {listHeader}
              {!selectedSection ? (
                error ? null : (
                  <ContentStatus
                    title={gt("No review diffs")}
                    detail={gt(
                      "This thread has no ready turn diffs and the worktree diff is empty.",
                    )}
                  />
                )
              ) : error && selectedSection.diff === null ? null : selectedSection.isLoading &&
                selectedSection.diff === null ? (
                <ContentStatus loading detail={gt("Loading diff…")} />
              ) : parsedDiff.kind === "empty" ? (
                <ContentStatus
                  title={gt("No changes")}
                  detail={selectedSection.subtitle ?? gt("This diff is empty.")}
                />
              ) : parsedDiff.kind === "raw" ? (
                <ContentBand spacing="roomy">
                  <Text className="text-xs leading-normal text-foreground-muted">
                    {parsedDiff.reason}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
                    <Text selectable className="font-mono text-xs leading-relaxed text-foreground">
                      {parsedDiff.text}
                    </Text>
                  </ScrollView>
                </ContentBand>
              ) : parsedDiff.kind === "files" && !allFilesHidden ? (
                <ContentBand spacing="roomy">
                  <Text className="text-xs leading-normal text-foreground-muted">
                    <T>Native diff view unavailable. Showing the raw patch.</T>
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
                    <Text selectable className="font-mono text-xs leading-relaxed text-foreground">
                      {selectedSection?.diff ?? ""}
                    </Text>
                  </ScrollView>
                </ContentBand>
              ) : null}
            </ScrollView>
          )}
          {showAndroidDiffNavigatorHud ? (
            <ReviewDiffNavigatorHud
              bottomInset={insets.bottom}
              viewedCount={visibleViewedFileCount}
              totalCount={reviewFiles.length}
              ringTrackColor={themeVariables["--color-border"]}
              ringFillColor={themeVariables["--color-primary"]}
              onPrevHunk={() => void handleNavigateHunk(-1)}
              onNextHunk={() => void handleNavigateHunk(1)}
            />
          ) : null}
          <ReviewSelectionActionBar
            bottomInset={insets.bottom}
            title={commentSelection.selectionAction?.title ?? null}
            onOpenComment={commentSelection.selectionAction?.onOpenComment ?? null}
            onClear={commentSelection.clearSelection}
          />
        </View>
      </ScreenContent>
    </>
  );
}
