import { T, useGT } from "gt-react-native";
import { Component, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { SymbolView } from "./ui/AppSymbol";
import { AppText as Text } from "./ui/AppText";
import { Button } from "./ui/Button";
import { useDeadlinePassed } from "../lib/clock";
import { tryCopyTextWithHaptic } from "../lib/copyTextWithHaptic";
import { errorDetailsPreview } from "./RenderErrorBoundary.logic";

interface RenderErrorBoundaryProps {
  readonly children: ReactNode;
  readonly resetKeys?: ReadonlyArray<unknown>;
  readonly renderFallback?: (props: RenderFailureProps) => ReactNode;
}

interface RenderErrorBoundaryState {
  readonly failed: boolean;
  readonly error: unknown;
  readonly componentStack?: string;
  readonly resetKeys?: ReadonlyArray<unknown>;
}

export interface RenderFailureProps {
  readonly details: string;
  readonly retry: () => void;
}

const COMPONENT_STACK_HEADING = "Component stack:";

function errorDetails(error: unknown, componentStack?: string): string {
  let description: string;
  try {
    description = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } catch {
    description = "Unknown render error";
  }
  return componentStack
    ? `${description}\n${COMPONENT_STACK_HEADING}\n${componentStack}`
    : description;
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = {
    failed: false,
    error: null,
    resetKeys: this.props.resetKeys,
  };

  static getDerivedStateFromProps(
    { resetKeys }: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    if (
      resetKeys?.length !== state.resetKeys?.length ||
      resetKeys?.some((key, index) => !Object.is(key, state.resetKeys?.[index]))
    ) {
      return { failed: false, error: null, componentStack: undefined, resetKeys };
    }
    return null;
  }

  static getDerivedStateFromError(error: unknown): Partial<RenderErrorBoundaryState> {
    return { failed: true, error };
  }

  override componentDidCatch(_error: unknown, info: { componentStack?: string }) {
    this.setState({ componentStack: info.componentStack });
  }

  private readonly retry = () => {
    this.setState({ failed: false, error: null, componentStack: undefined });
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    const fallback =
      this.props.renderFallback ??
      ((props: RenderFailureProps) => <RenderFailureView {...props} />);
    return fallback({
      details: errorDetails(this.state.error, this.state.componentStack),
      retry: this.retry,
    });
  }
}

const COPIED_FEEDBACK_DURATION_MS = 2000;

export function RenderFailureView(
  props: RenderFailureProps & {
    readonly title?: string;
    readonly bottomInset?: number;
    readonly exit?: { readonly label: string; readonly onPress: () => void };
  },
) {
  const gt = useGT();
  const title = props.title ?? gt("This screen couldn't be displayed");
  const [copiedAtMs, setCopiedAtMs] = useState<number | null>(null);
  const copyFeedbackEnded = useDeadlinePassed(
    copiedAtMs === null ? null : copiedAtMs + COPIED_FEEDBACK_DURATION_MS,
  );
  const copied = copiedAtMs !== null && !copyFeedbackEnded;

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerClassName="flex-grow items-center justify-center gap-5 px-6 py-8"
      contentContainerStyle={
        props.bottomInset ? { paddingBottom: 32 + props.bottomInset } : undefined
      }
    >
      <View className="size-12 items-center justify-center rounded-full border border-danger-border bg-danger">
        <SymbolView
          name="exclamationmark.triangle"
          size={22}
          tintColorClassName="accent-danger-foreground"
          type="monochrome"
        />
      </View>
      <View className="max-w-sm items-center gap-2">
        <Text accessibilityRole="header" className="text-center text-xl font-t3-bold">
          {title}
        </Text>
        <Text className="text-center text-sm text-foreground-muted">
          <T>Try again. If it keeps happening, copy the details for a bug report.</T>
        </Text>
      </View>
      <View className="w-full max-w-md rounded-2xl border border-danger-border bg-card px-4 py-3">
        <Text selectable className="font-mono text-xs leading-relaxed text-danger-foreground">
          {errorDetailsPreview(props.details)}
        </Text>
      </View>
      <View className="w-full max-w-xs gap-2">
        <Button label={gt("Try again")} onPress={props.retry} tone="primary" fullWidth />
        <Button
          icon={copied ? "checkmark" : "doc.on.doc"}
          label={copied ? gt("Copied") : gt("Copy details")}
          onPress={() => {
            void tryCopyTextWithHaptic(props.details, { target: "error details" }).then((ok) => {
              if (ok) setCopiedAtMs(Date.now());
            });
          }}
          fullWidth
        />
        {props.exit ? (
          <Button label={props.exit.label} onPress={props.exit.onPress} tone="text" fullWidth />
        ) : null}
      </View>
    </ScrollView>
  );
}
