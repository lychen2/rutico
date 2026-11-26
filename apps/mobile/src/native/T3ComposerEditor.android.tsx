import { useCallback, useRef } from "react";
import { PixelRatio } from "react-native";

import { ComposerEditor as NativeComposerEditor } from "./T3ComposerEditor.native";
import type { ComposerEditorProps } from "./T3ComposerEditor.types";

/**
 * Android ComposerEditor wrapper that deduplicates native content-size reports on the physical
 * pixel grid so outer-shell height/radius transitions never oscillate with native EditText layouts.
 */
export function ComposerEditor(props: ComposerEditorProps) {
  const { onContentSizeChange, ...rest } = props;
  const lastReportedPixelsRef = useRef<{ readonly width: number; readonly height: number } | null>(
    null,
  );

  const handleContentSizeChange = useCallback(
    (size: { readonly width: number; readonly height: number }) => {
      if (!onContentSizeChange) return;
      const widthPx = PixelRatio.roundToNearestPixel(size.width);
      const heightPx = PixelRatio.roundToNearestPixel(size.height);
      const previous = lastReportedPixelsRef.current;
      if (previous !== null && previous.width === widthPx && previous.height === heightPx) {
        return;
      }
      lastReportedPixelsRef.current = { width: widthPx, height: heightPx };
      onContentSizeChange({ width: widthPx, height: heightPx });
    },
    [onContentSizeChange],
  );

  return (
    <NativeComposerEditor
      {...rest}
      onContentSizeChange={onContentSizeChange ? handleContentSizeChange : undefined}
    />
  );
}

export type {
  ComposerEditorHandle,
  ComposerEditorProps,
  ComposerEditorSelection,
} from "./T3ComposerEditor.types";
