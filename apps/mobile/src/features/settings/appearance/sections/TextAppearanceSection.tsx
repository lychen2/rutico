import { useGT } from "gt-react-native";
import { useState } from "react";
import {
  BASE_FONT_SIZE_STEP,
  DEFAULT_BASE_FONT_SIZE,
  MAX_BASE_FONT_SIZE,
  MIN_BASE_FONT_SIZE,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TextAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

export function TextAppearanceSection() {
  const gt = useGT();
  const { isReady, appearance, setBaseFontSize, mathRenderingEnabled, setMathRenderingEnabled } =
    useAppearancePreferences();
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const displayedSize = previewSize ?? appearance.baseFontSize;

  return (
    <SettingsSection title={gt("Text", { $context: "settings section for text size" })}>
      <TextAppearancePreview fontSize={displayedSize} previewing={previewSize !== null} />
      <AppearancePreviewSeparator />
      <FontSizeSliderRow
        defaultValue={DEFAULT_BASE_FONT_SIZE}
        disabled={!isReady}
        formatValueLabel={(size) => gt("{size} pt", { size })}
        icon="textformat.size"
        label={gt("Text size")}
        max={MAX_BASE_FONT_SIZE}
        min={MIN_BASE_FONT_SIZE}
        onChange={setBaseFontSize}
        onPreviewChange={setPreviewSize}
        step={BASE_FONT_SIZE_STEP}
        value={appearance.baseFontSize}
        valueLabel={gt("{size} pt", { size: appearance.baseFontSize })}
      />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="plusminus"
        label={gt("Render math")}
        value={mathRenderingEnabled}
        onValueChange={setMathRenderingEnabled}
      />
    </SettingsSection>
  );
}
