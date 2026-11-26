import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { APP_VERSION } from "../../branding";
import { AnchoredToastProvider } from "../ui/toast";
import { AboutVersionTitle } from "./AboutVersionTitle";

it("copies the version with inline check confirmation and tooltip swap instead of a toast", async () => {
  await using screen = await render(
    <AnchoredToastProvider>
      <AboutVersionTitle />
    </AnchoredToastProvider>,
  );
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  const button = screen.getByRole("button", { name: `Copy version ${APP_VERSION}` });
  await userEvent.hover(button);
  await expect.element(page.getByText("Copy version", { exact: true })).toBeVisible();

  await button.click();

  expect(write).toHaveBeenCalledWith(APP_VERSION);
  expect(screen.container.querySelector("svg.t3-icon-pop")).not.toBeNull();
  expect(document.querySelector('[data-slot="toast"]')).toBeNull();
  await expect.element(page.getByText("Copied", { exact: true })).toBeVisible();
});
