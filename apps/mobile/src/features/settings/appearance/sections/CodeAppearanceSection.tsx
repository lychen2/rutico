import { useGT } from "gt-react-native";
import { useState } from "react";
import {
  CODE_FONT_SIZE_STEP,
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
} from "../../../../lib/appearancePreferences";
import { MOBILE_CODE_SURFACE } from "../../../../lib/typography";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  CodeAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";

export function CodeAppearanceSection() {
  const gt = useGT();
  const { isReady, appearance, setCodeFontSize, setCodeWordBreak } = useAppearancePreferences();
  const custom = appearance.isCodeFontSizeCustom;
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const displayedSize = custom ? (previewSize ?? appearance.codeFontSize) : appearance.codeFontSize;

  const handleToggleCustom = (enabled: boolean) => {
    setPreviewSize(null);
    setCodeFontSize(enabled ? appearance.codeFontSize : null);
  };

  return (
    <SettingsSection title={gt("Code & Diffs")}>
      <CodeAppearancePreview
        fontSize={displayedSize}
        previewing={custom && previewSize !== null}
        wordBreak={appearance.codeWordBreak}
      />
      <AppearancePreviewSeparator />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="chevron.left.forwardslash.chevron.right"
        label={gt("Custom font size")}
        onValueChange={handleToggleCustom}
        value={custom}
      />
      {custom ? (
        <FontSizeSliderRow
          defaultValue={MOBILE_CODE_SURFACE.fontSize}
          disabled={!isReady}
          formatValueLabel={(size) => gt("{size} pt", { size })}
          icon="textformat.size"
          label={gt("Font size")}
          max={MAX_CODE_FONT_SIZE}
          min={MIN_CODE_FONT_SIZE}
          onChange={setCodeFontSize}
          onPreviewChange={setPreviewSize}
          step={CODE_FONT_SIZE_STEP}
          value={appearance.codeFontSize}
          valueLabel={gt("{size} pt", { size: appearance.codeFontSize })}
        />
      ) : null}
      <SettingsSwitchRow
        disabled={!isReady}
        icon="text.word.spacing"
        label={gt("Word break")}
        onValueChange={setCodeWordBreak}
        value={appearance.codeWordBreak}
      />
    </SettingsSection>
  );
}
