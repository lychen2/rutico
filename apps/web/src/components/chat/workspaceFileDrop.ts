export interface WorkspaceFileDragSummary {
  readonly total: number;
  readonly imageCount: number;
  readonly fileCount: number;
}

interface WorkspaceFileDragEvent {
  readonly dataTransfer: {
    readonly types: ReadonlyArray<string>;
    readonly files: Iterable<File>;
    readonly items?: Iterable<{
      readonly kind: string;
      readonly type?: string;
      getAsFile(): File | null;
      webkitGetAsEntry(): { readonly isDirectory: boolean } | null;
    }>;
    dropEffect: string;
  };
  readonly relatedTarget: EventTarget | null;
  readonly currentTarget: {
    contains(target: Node | null): boolean;
  };
  preventDefault(): void;
}

interface WorkspaceFileDropHost {
  setDragActive(active: boolean): void;
  addFiles(files: File[]): void;
  addFolders(folders: File[]): void;
  onDragSummary?: (summary: WorkspaceFileDragSummary | null) => void;
}

function isFileDrag(event: WorkspaceFileDragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

function movedWithinDropTarget(event: WorkspaceFileDragEvent): boolean {
  return event.relatedTarget !== null && event.currentTarget.contains(event.relatedTarget as Node);
}

export function summarizeDraggedItems(
  dataTransfer: Pick<WorkspaceFileDragEvent["dataTransfer"], "files" | "items">,
): WorkspaceFileDragSummary {
  let total = 0;
  let imageCount = 0;
  if (dataTransfer.items !== undefined) {
    for (const item of dataTransfer.items) {
      if (item.kind !== "file") continue;
      total += 1;
      if (typeof item.type === "string" && item.type.startsWith("image/")) {
        imageCount += 1;
      }
    }
  } else {
    for (const file of dataTransfer.files) {
      total += 1;
      if (file.type.startsWith("image/")) {
        imageCount += 1;
      }
    }
  }
  return { total, imageCount, fileCount: total - imageCount };
}

export function splitTransferredFiles(
  dataTransfer: Pick<WorkspaceFileDragEvent["dataTransfer"], "files" | "items">,
): {
  files: File[];
  folders: File[];
} {
  if (dataTransfer.items === undefined)
    return { files: Array.from(dataTransfer.files), folders: [] };

  const files: File[] = [];
  const folders: File[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null) continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) {
      folders.push(file);
    } else {
      files.push(file);
    }
  }
  return { files, folders };
}

export function makeWorkspaceFileDropHandlers(host: WorkspaceFileDropHost) {
  return {
    onDragEnter(event: WorkspaceFileDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (movedWithinDropTarget(event)) return;
      host.onDragSummary?.(summarizeDraggedItems(event.dataTransfer));
      host.setDragActive(true);
    },
    onDragOver(event: WorkspaceFileDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      host.onDragSummary?.(summarizeDraggedItems(event.dataTransfer));
      host.setDragActive(true);
    },
    onDragLeave(event: WorkspaceFileDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (movedWithinDropTarget(event)) return;
      host.onDragSummary?.(null);
      host.setDragActive(false);
    },
    onDrop(event: WorkspaceFileDragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      host.onDragSummary?.(null);
      host.setDragActive(false);
      const { files, folders } = splitTransferredFiles(event.dataTransfer);
      if (files.length > 0) host.addFiles(files);
      if (folders.length > 0) host.addFolders(folders);
    },
  };
}
