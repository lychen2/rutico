import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarChromeFooter } from "./SidebarChrome";

vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  useIssuesSupported: () => true,
  usePullRequestsSupported: () => true,
}));
vi.mock("./SidebarThreadUndoNotice", () => ({ SidebarThreadUndoNotice: () => null }));
vi.mock("./SidebarProviderUpdatePill", () => ({ SidebarProviderUpdatePill: () => null }));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
  SidebarUpdateArchitectureWarning: () => null,
}));

it("keeps archiving one click away and opens the issue list from More", async () => {
  await using screen = await render(
    <SidebarProvider>
      <SidebarChromeFooter />
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: "Archived threads" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Pull requests" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "More" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Pull requests" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Issues" }).click();
  await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/issues"));
});
