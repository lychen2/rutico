import type { ComponentProps } from "react";
import type { SymbolView } from "./AppSymbol";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export interface SliderRowProps {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly minimumIcon?: SymbolName;
  readonly maximumIcon?: SymbolName;
  readonly label: string;
  readonly valueLabel: string;
  readonly formatValueLabel?: (value: number) => string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Optional recommended default value rendered as a tactile magnetic detent marker. */
  readonly defaultValue?: number;
  /** Ephemeral live preview callback fired during drag (null on release), decoupled from persistence. */
  readonly onPreviewChange?: (value: number | null) => void;
  readonly onChange: (value: number) => void;
}
