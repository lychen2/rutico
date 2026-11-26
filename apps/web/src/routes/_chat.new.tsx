import { parseNewThreadLink } from "@t3tools/shared/promptLinksCopy";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { T, useMessages } from "gt-react";
import { Link2OffIcon } from "lucide-react";
import { NewThreadLinkView } from "../components/promptLinks/NewThreadLinkView";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { SpecularHeroCard } from "../components/ui/standalone-page";

// The query is read raw: the router's own search parsing turns `prompt=123` into a number.
function NewThreadLinkRoute() {
  const search = useLocation({ select: (location) => location.searchStr });
  const resolve = useMessages();
  const parsed = parseNewThreadLink(search, resolve);
  if (!parsed.ok) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <Empty className="flex-1">
          <SpecularHeroCard maxWidth="md">
            <EmptyHeader className="max-w-none">
              <EmptyMedia className="mb-4" variant="icon">
                <Link2OffIcon className="text-warning-foreground" />
              </EmptyMedia>
              <EmptyTitle>
                <T>Could not open the link</T>
              </EmptyTitle>
              <EmptyDescription>{parsed.error}</EmptyDescription>
            </EmptyHeader>
          </SpecularHeroCard>
        </Empty>
      </SidebarInset>
    );
  }
  return <NewThreadLinkView key={search} link={parsed.value} />;
}

export const Route = createFileRoute("/_chat/new")({
  component: NewThreadLinkRoute,
});
