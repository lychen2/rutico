import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId, type ThreadArtifact } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThreadArtifactsPanel } from "./ThreadArtifactsPanel";

const { list, mintUrl, previewUrl } = vi.hoisted(() => ({
  list: vi.fn(),
  mintUrl: vi.fn<() => Promise<string | null>>(),
  previewUrl: vi.fn(),
}));

vi.mock(import("~/state/assets"), async (original) => ({
  ...(await original()),
  threadArtifactsQuery: list,
}));
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: previewUrl,
  useAssetUrlRefresh: () => mintUrl,
}));

it("distinguishes an older server from a failed request and a successful empty list", async () => {
  const threadId = ThreadId.make("artifact-thread");
  const environmentId = EnvironmentId.make("artifact-environment");
  const data = Atom.make<AsyncResult.AsyncResult<{ artifacts: readonly ThreadArtifact[] }, Error>>(
    AsyncResult.initial(),
  );
  list.mockReset().mockReturnValue(data);
  const registry = AtomRegistry.make();
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <ThreadArtifactsPanel
        environmentId={environmentId}
        threadId={threadId}
        onAttachFiles={vi.fn()}
      />
    </RegistryContext.Provider>,
  );
  await expect.element(screen.getByText("Loading artifacts…")).toBeVisible();
  registry.set(
    data,
    AsyncResult.failure(Cause.die("Unknown request tag: assets.listThreadArtifacts")),
  );
  await expect
    .element(
      screen.getByText(
        "This server does not support thread artifacts. Update the environment and reconnect.",
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Retry" })).not.toBeInTheDocument();

  registry.set(data, AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
  await expect.element(screen.getByRole("button", { name: "Retry" })).toBeVisible();

  registry.set(data, AsyncResult.success({ artifacts: [] }));
  await expect.element(screen.getByText("No artifacts in this thread yet.")).toBeVisible();
});

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

it("filters the real list counts and previews the selected artifact in a narrow panel", async () => {
  const threadId = ThreadId.make("artifact-thread");
  const environmentId = EnvironmentId.make("artifact-environment");
  const files: Pick<ThreadArtifact, "name" | "kind" | "mimeType">[] = [
    { name: "new.png", kind: "image", mimeType: "image/png" },
    { name: "older.png", kind: "image", mimeType: "image/png" },
    { name: "clip.webm", kind: "video", mimeType: "video/webm" },
  ];
  const artifacts = files.map(
    ({ name, kind, mimeType }) =>
      ({
        name,
        kind,
        mimeType,
        sizeBytes: 42,
        modifiedAt: 1_780_000_000_000,
        resource: { _tag: "media-file", threadId, path: `/work/${name}`, hostOnly: true },
      }) satisfies ThreadArtifact,
  );
  list.mockReset().mockReturnValue(Atom.make(AsyncResult.success({ artifacts })));
  previewUrl.mockReset().mockReturnValue({ _tag: "Loading" });
  const container = document.createElement("div");
  container.style.width = "280px";
  await using screen = await render(
    <ThreadArtifactsPanel
      environmentId={environmentId}
      threadId={threadId}
      onAttachFiles={vi.fn()}
    />,
    { container },
  );
  await expect.element(screen.getByRole("article", { name: "Preview new.png" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^older\.png/ }));
  await expect.element(screen.getByRole("article", { name: "Preview older.png" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Attach older.png to draft" }))
    .toBeVisible();

  const filter = screen.getByRole("combobox", { name: "Artifact type" });
  await expect.element(filter).toHaveTextContent("All · 3");
  await userEvent.click(filter);
  await userEvent.click(page.getByRole("option", { name: "Videos · 1" }));
  await expect.element(screen.getByRole("article", { name: "Preview clip.webm" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^new\.png/ })).not.toBeInTheDocument();

  await userEvent.click(filter);
  await userEvent.click(page.getByRole("option", { name: "Pages · 0" }));
  await expect.element(screen.getByText("No artifacts of this type.")).toBeVisible();
});
