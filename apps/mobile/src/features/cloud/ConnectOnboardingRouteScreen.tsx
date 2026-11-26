import { T, useGT } from "gt-react-native";
import { AppBar } from "../../components/ui/AppBar";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";

import { useAuth } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { CloudEnvironmentRows } from "../connection/CloudEnvironmentRows";
import { splitEnvironmentSections } from "../connection/environmentSections";
import { useConnectionController } from "../connection/useConnectionController";
import { optOutOfConnectOnboarding } from "./connectOnboardingOptOut";
import { hasCloudPublicConfig } from "./publicConfig";

// Only reachable with cloud config: onboarding is requested after a T3 Connect
// sign-in, and appLinking drops the deep link otherwise.
export function ConnectOnboardingRouteScreen() {
  return hasCloudPublicConfig() ? <ConfiguredConnectOnboardingRouteScreen /> : null;
}

function ConfiguredConnectOnboardingRouteScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const { connectedEnvironments, onSetEnvironmentEnabled, onRemoveEnvironmentPress } =
    useRemoteConnections();
  const { refreshRelayEnvironments } = useConnectionController();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const enterProgress = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- springs the T3 Connect onboarding card into view on mount
  useEffect(() => {
    enterProgress.set(withSpring(1, SPRING_SPATIAL_SNAPPY));
  }, [enterProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enterProgress.get(),
    transform: [{ translateY: (1 - enterProgress.get()) * 12 }],
  }));

  const handleRefresh = () => {
    triggerSemanticHaptic("contextClick");
    setIsRefreshing(true);
    void refreshRelayEnvironments().finally(() => setIsRefreshing(false));
  };

  const handleClose = () => {
    navigation.goBack();
  };

  // Persist before dismissing so quick sign-out/sign-in cannot outrun the write.
  const handleDontShowAgain = () => {
    triggerSemanticHaptic("toggleOff");
    void (async () => {
      if (userId) {
        const result = await settlePromise(() => optOutOfConnectOnboarding(userId));
        reportAtomCommandResult(result, { label: "connect onboarding opt-out" });
      }
      navigation.goBack();
    })();
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar
        title={gt("Set up {product}", { product: "T3 Connect" })}
        onClose={handleClose}
        refresh={{
          accessibilityLabel: gt("Refresh environments"),
          disabled: isRefreshing,
          onPress: handleRefresh,
        }}
      />
      <ScrollView
        nestedScrollEnabled
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          gap: 16,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        <Animated.View
          collapsable={false}
          style={cardStyle}
          className="flex-row items-center gap-3.5 rounded-[24px] border border-border-subtle bg-grouped-card p-4"
        >
          <View className="size-11 items-center justify-center rounded-2xl bg-subtle">
            <SymbolView
              name="point.3.connected.trianglepath.dotted"
              size={20}
              tintColorClassName="accent-foreground"
              type="monochrome"
            />
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-t3-bold text-foreground">
              <T>Connect your machines</T>
            </Text>
            <Text className="text-xs leading-normal text-foreground-muted">
              <T>Reach your published environments securely from this device.</T>
            </Text>
          </View>
        </Animated.View>

        {isSignedIn ? (
          <CloudEnvironmentRows
            connectedCloudEnvironments={connectedCloudEnvironments}
            onSetEnvironmentEnabled={onSetEnvironmentEnabled}
            onRemoveEnvironment={onRemoveEnvironmentPress}
            showHeader={false}
          />
        ) : (
          <View
            collapsable={false}
            className="rounded-[24px] border border-border-subtle bg-grouped-card p-5"
          >
            <Text className="text-sm leading-normal text-foreground-muted">
              {gt("Sign in to your T3 account to set up {product}.", { product: "T3 Connect" })}
            </Text>
          </View>
        )}

        {userId ? (
          <Button label={gt("Don't show this again")} tone="text" onPress={handleDontShowAgain} />
        ) : null}
      </ScrollView>
    </View>
  );
}
