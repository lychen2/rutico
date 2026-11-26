import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { Toggle } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { UsageSegments } from "./UsageSegments";

function MixedMetricSegments() {
  const [metric, setMetric] = useState<"cost" | "tokens" | "limits">("cost");
  return (
    <TooltipProvider>
      <UsageSegments
        aria-label="Usage metric"
        variant="segmented"
        value={[metric]}
        onValueChange={(next) => {
          const picked = next[0];
          if (picked === "cost" || picked === "tokens" || picked === "limits") {
            setMetric(picked);
          }
        }}
      >
        <Toggle value="cost">Cost</Toggle>
        <Tooltip>
          <TooltipTrigger render={<Toggle value="tokens">Tokens</Toggle>} />
          <TooltipPopup>Tokens (T)</TooltipPopup>
        </Tooltip>
        <Toggle value="limits">Limits</Toggle>
      </UsageSegments>
    </TooltipProvider>
  );
}

it("moves the selection thumb when mixing plain toggles and TooltipTrigger-wrapped toggles", async () => {
  await using screen = await render(<MixedMetricSegments />);
  const thumb = screen.container.querySelector<HTMLElement>("[data-usage-thumb]")!;
  const costButton = screen.getByRole("button", { name: "Cost" }).element() as HTMLElement;
  const tokensButton = screen.getByRole("button", { name: "Tokens" }).element() as HTMLElement;

  expect(costButton.hasAttribute("data-pressed")).toBe(true);
  expect(thumb.style.transform).toBe(`translateX(${costButton.offsetLeft}px)`);

  await screen.getByRole("button", { name: "Tokens" }).click();

  expect(tokensButton.hasAttribute("data-pressed")).toBe(true);
  expect(costButton.hasAttribute("data-pressed")).toBe(false);
  expect(thumb.style.transform).toBe(`translateX(${tokensButton.offsetLeft}px)`);
  expect(thumb.style.width).toBe(`${tokensButton.offsetWidth}px`);
});
