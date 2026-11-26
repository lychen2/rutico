import {
  createNavigatorFactory,
  StackRouter,
  useNavigationBuilder,
  type NavigatorTypeBagBase,
  type ParamListBase,
  type StackActionHelpers,
  type StackNavigationState,
  type StackRouterOptions,
  type StaticConfig,
  type TypedNavigator,
} from "@react-navigation/native";
import {
  NativeStackView,
  type NativeStackNavigationEventMap,
  type NativeStackNavigationOptions,
  type NativeStackNavigatorProps,
  type NativeStackTypeBag,
} from "@react-navigation/native-stack";
import { use, type ComponentProps } from "react";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated";

import { BottomSheetContext } from "../../components/ui/BottomSheetContext";
import { RoutedFormSheetContext } from "../../components/ui/RoutedFormSheetContext";
import {
  useAndroidPredictiveBackProgress,
  useSyncAndroidModalBackCount,
} from "../../native/androidPredictiveBack";

import {
  isPresentedRoute,
  projectStackPresentation,
} from "../../native/workspace-stack-projection";
import {
  WorkspaceColumnsRendererContext,
  WorkspacePresentationHostContext,
} from "./workspace-presentation-context";

type ViewProps = ComponentProps<typeof NativeStackView>;
type Descriptor = ViewProps["descriptors"][string];
type Route = ViewProps["state"]["routes"][number];

function WorkspaceStackView(props: ViewProps) {
  const renderColumns = use(WorkspaceColumnsRendererContext);
  const reducedMotion = useReducedMotion();

  const isOverlay = (route: Route) => {
    const descriptor = props.descriptors[route.key] ?? props.describe(route, true);
    return isPresentedRoute(descriptor.options);
  };
  const projection = renderColumns ? projectStackPresentation(props.state, isOverlay) : null;
  const overlayCount = projection?.overlays.length ?? 0;
  const workspaceRoutes = projection?.workspace ?? props.state.routes;
  const canPopWorkspace = workspaceRoutes.length > 1;

  // Report modal overlays to native single-owner arbitration so modals strictly beat
  // the expanded Compose navigation rail and side panels.
  useSyncAndroidModalBackCount(overlayCount);

  // Subscribe to API 34-35 predictive back progress for whichever stack tier owns back
  // (modal overlay when present, otherwise workspace screen stack). React Navigation /
  // react-native-screens performs the single commit via RN back dispatch, so this layer
  // drives interactive preview only and never triggers a second pop.
  const modalPreview = useAndroidPredictiveBackProgress({
    layer: "modal",
    enabled: overlayCount > 0,
  });
  const stackPreview = useAndroidPredictiveBackProgress({
    layer: "screen-stack",
    enabled: overlayCount === 0 && canPopWorkspace,
  });

  const activeProgress = overlayCount > 0 ? modalPreview.progress : stackPreview.progress;
  const activeEdge = overlayCount > 0 ? modalPreview.swipeEdge : stackPreview.swipeEdge;

  const predictiveBackPreviewStyle = useAnimatedStyle(() => {
    const p = activeProgress.get();
    if (p <= 0.001) {
      return {
        opacity: 1,
        borderRadius: 0,
        transform: [{ translateX: 0 }, { scale: 1 }],
      };
    }
    if (reducedMotion) {
      return {
        opacity: interpolate(p, [0, 1], [1, 0.86], Extrapolation.CLAMP),
        borderRadius: 0,
        transform: [{ translateX: 0 }, { scale: 1 }],
      };
    }
    const direction = activeEdge.get() === 1 ? -1 : 1;
    return {
      opacity: interpolate(p, [0, 1], [1, 0.94], Extrapolation.CLAMP),
      borderRadius: interpolate(p, [0, 0.15, 1], [0, 16, 24], Extrapolation.CLAMP),
      overflow: "hidden" as const,
      transform: [
        { translateX: direction * interpolate(p, [0, 1], [0, 28], Extrapolation.CLAMP) },
        { scale: interpolate(p, [0, 1], [1, 0.94], Extrapolation.CLAMP) },
      ],
    };
  });

  if (!renderColumns || !projection) {
    return (
      <Animated.View style={[{ flex: 1 }, predictiveBackPreviewStyle]}>
        <NativeStackView {...props} />
      </Animated.View>
    );
  }

  const visibleRoute = workspaceRoutes.at(-1);
  if (!visibleRoute) {
    return (
      <Animated.View style={[{ flex: 1 }, predictiveBackPreviewStyle]}>
        <NativeStackView {...props} />
      </Animated.View>
    );
  }

  const visibleDescriptor = props.descriptors[visibleRoute.key]!;
  // Home is the sidebar beside the pages, and under them the page shown when none is selected.
  const home = workspaceRoutes.find((route) => route.name === "Home");
  const baseRoute = { key: `${props.state.key}:workspace`, name: "Workspace" };
  const baseDescriptor: Descriptor = {
    ...visibleDescriptor,
    options: { headerShown: false, freezeOnBlur: false },
    render: () =>
      renderColumns(
        <NativeStackView
          {...props}
          state={{
            ...props.state,
            routes: workspaceRoutes,
            index: workspaceRoutes.length - 1,
            preloadedRoutes: props.state.preloadedRoutes.filter((route) => !isOverlay(route)),
          }}
        />,
        home ? props.descriptors[home.key]?.render() : null,
      ),
  };
  const routes = [baseRoute, ...projection.overlays];
  return (
    <Animated.View style={[{ flex: 1 }, predictiveBackPreviewStyle]}>
      <NativeStackView
        {...props}
        presentationEnvelope
        state={{
          ...props.state,
          routes,
          index: routes.length - 1,
          preloadedRoutes: props.state.preloadedRoutes.filter(isOverlay),
        }}
        descriptors={{ ...props.descriptors, [baseRoute.key]: baseDescriptor }}
      />
    </Animated.View>
  );
}

function WorkspaceStackNavigator({
  id,
  initialRouteName,
  UNSTABLE_routeNamesChangeBehavior,
  children,
  layout,
  screenListeners,
  screenOptions,
  screenLayout,
  UNSTABLE_router,
  ...rest
}: NativeStackNavigatorProps) {
  const { state, describe, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    StackNavigationState<ParamListBase>,
    StackRouterOptions,
    StackActionHelpers<ParamListBase>,
    NativeStackNavigationOptions,
    NativeStackNavigationEventMap
  >(StackRouter, {
    id,
    initialRouteName,
    UNSTABLE_routeNamesChangeBehavior,
    children,
    layout,
    screenListeners,
    screenOptions,
    screenLayout,
    UNSTABLE_router,
  });
  return (
    <WorkspacePresentationHostContext value>
      <NavigationContent>
        <WorkspaceStackView
          {...rest}
          state={state}
          describe={describe}
          descriptors={Object.fromEntries(
            Object.entries(descriptors).map(([key, descriptor]) => [
              key,
              {
                ...descriptor,
                // Screens draw their bar in-tree; hiding the native one only after mount
                // shows it for the first frame and leaves the page measured short.
                options: { ...descriptor.options, headerShown: false },
                ...(descriptor.options.presentation === "formSheet"
                  ? {
                      render: () => (
                        <BottomSheetContext value>
                          <RoutedFormSheetContext value>
                            {descriptor.render()}
                          </RoutedFormSheetContext>
                        </BottomSheetContext>
                      ),
                    }
                  : undefined),
              },
            ]),
          )}
          navigation={navigation}
        />
      </NavigationContent>
    </WorkspacePresentationHostContext>
  );
}

type WorkspaceTypeBag<
  ParamList extends ParamListBase,
  NavigatorID extends string | undefined,
> = Omit<NativeStackTypeBag<ParamList, NavigatorID>, "Navigator"> & {
  Navigator: typeof WorkspaceStackNavigator;
};

export function createWorkspaceStackNavigator<
  const ParamList extends ParamListBase,
  const NavigatorID extends string | undefined = string | undefined,
  const TypeBag extends NavigatorTypeBagBase = WorkspaceTypeBag<ParamList, NavigatorID>,
  const Config extends StaticConfig<TypeBag> = StaticConfig<TypeBag>,
>(config?: Config): TypedNavigator<TypeBag, Config> {
  return createNavigatorFactory(WorkspaceStackNavigator)(config);
}
