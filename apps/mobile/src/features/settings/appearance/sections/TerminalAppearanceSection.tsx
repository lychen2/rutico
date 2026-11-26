import { useGT } from "gt-react-native";
import { useState } from "react";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
} from "../../../../lib/appearancePreferences";
import { DEFAULT_TERMINAL_FONT_SIZE } from "../../../terminal/terminalPreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TerminalAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";

export function TerminalAppearanceSection() {
  const gt = useGT();
  const { isReady, appearance, setTerminalFontSize } = useAppearancePreferences();
  const custom = appearance.isTerminalFontSizeCustom;
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const displayedSize = custom
    ? (previewSize ?? appearance.terminalFontSize)
    : appearance.terminalFontSize;

  const handleToggleCustom = (enabled: boolean) => {
    setPreviewSize(null);
    setTerminalFontSize(enabled ? appearance.terminalFontSize : null);
  };

  return (
    <SettingsSection title={gt("Terminal", { $context: "settings section for the terminal" })}>
      <TerminalAppearancePreview
        fontSize={displayedSize}
        previewing={custom && previewSize !== null}
      />
      <AppearancePreviewSeparator />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="terminal"
        label={gt("Custom font size")}
        onValueChange={handleToggleCustom}
        value={custom}
      />
      {custom ? (
        <FontSizeSliderRow
          defaultValue={DEFAULT_TERMINAL_FONT_SIZE}
          disabled={!isReady}
          formatValueLabel={(size) => gt("{size} pt", { size: size.toFixed(1) })}
          icon="textformat.size"
          label={gt("Font size")}
          max={MAX_TERMINAL_FONT_SIZE}
          min={MIN_TERMINAL_FONT_SIZE}
          onChange={setTerminalFontSize}
          onPreviewChange={setPreviewSize}
          step={TERMINAL_FONT_SIZE_STEP}
          value={appearance.terminalFontSize}
          valueLabel={gt("{size} pt", { size: appearance.terminalFontSize.toFixed(1) })}
        />
      ) : null}
    </SettingsSection>
  );
}
