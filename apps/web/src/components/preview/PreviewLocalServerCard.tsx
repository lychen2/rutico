import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";

import type { MessageResolver } from "../../i18n/messages";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { DiscoveryListRow } from "../ui/discovery-list";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  server: PreviewableServer;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ threadRef, server, onOpen }: Props) {
  const m = useMessages();
  const subtitle = describeServer(server, m);
  return (
    <DiscoveryListRow
      onClick={onOpen}
      icon={
        <span className="relative inline-flex shrink-0 items-center justify-center">
          <PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />
          <span
            ref={observeVisibleAnimation}
            aria-hidden="true"
            className="preview-server-live-dot absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-success ring-1 ring-background"
          />
        </span>
      }
      title={subtitle}
      description={`${server.host}:${server.port}`}
    />
  );
}

function describeServer(server: PreviewableServer, resolve: MessageResolver): string {
  if (server.processName) return server.processName;
  return resolve(msg("Listening", { $context: "a local server is listening on a port" }));
}
