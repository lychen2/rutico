import { EnvironmentId, ThreadId, type ThreadArtifact } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThreadArtifactsPanel } from "./ThreadArtifactsPanel";

const { list, mintUrl } = vi.hoisted(() => ({
  list: vi.fn(),
  mintUrl: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("~/state/assets", () => ({ threadArtifactsQuery: list }));
vi.mock("~/state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false }),
}));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: vi.fn(),
  useAssetUrlRefresh: () => mintUrl,
}));

it("adds the artifact's downloaded bytes to the draft as a named file", async () => {
  const threadId = ThreadId.make("artifact-thread");
  const environmentId = EnvironmentId.make("artifact-environment");
  const content = "A generated report";
  const artifact = {
    name: "report.txt",
    kind: "document",
    resource: { _tag: "media-file", threadId, path: "/work/report.txt", hostOnly: true },
    mimeType: "text/plain",
    sizeBytes: content.length,
    modifiedAt: 1_780_000_000_000,
  } satisfies ThreadArtifact;
  const data = Atom.make(AsyncResult.success({ artifacts: [artifact] }));
  list.mockReset().mockReturnValue(data);
  const url = URL.createObjectURL(new Blob([content]));
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(url) };
  mintUrl.mockReset().mockResolvedValue(url);

  const appended = Promise.withResolvers<File[]>();
  await using screen = await render(
    <ThreadArtifactsPanel
      environmentId={environmentId}
      threadId={threadId}
      onAttachFiles={appended.resolve}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Attach report.txt to draft" }));
  const files = await appended.promise;
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    name: artifact.name,
    type: artifact.mimeType,
    lastModified: artifact.modifiedAt,
  });
  expect(await files[0]?.text()).toBe(content);
});
