import { useAuth, useClerk } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { msg, T, useGT, useMessages } from "gt-react";
import { CloudIcon, TerminalIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliSignInRedirectUrl,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import "~/styles/pairing-motion.css";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { retryClerkLoad, useClerkLoadFailed } from "../clerk/clerkLoadFailure";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

const invalidLinkMessage = {
  context: msg("Authorization request"),
  title: msg("This connect link is incomplete"),
  description: msg(
    "The link is missing its authorization request. Re-run `t3 connect` in your terminal and open the freshly printed URL.",
  ),
} as const;

export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const gt = useGT();
  const m = useMessages();
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const loadFailed = useClerkLoadFailed();
  const signInOpened = useRef(false);
  const redirecting = useRef(false);

  const openSignIn = () => {
    if (!request) {
      return;
    }
    clerk.openSignIn(
      resolveClerkSignInProps(
        connectCliSignInRedirectUrl(request, window.location.href),
        isElectron,
      ),
    );
  };
  const openSignInOnLoad = useEffectEvent(openSignIn);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens Clerk sign-in or navigates the window to the authorize URL once Clerk has loaded
  useEffect(() => {
    if (!request || !isLoaded || redirecting.current) {
      return;
    }
    if (!isSignedIn) {
      if (!signInOpened.current) {
        signInOpened.current = true;
        openSignInOnLoad();
      }
      return;
    }
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) {
      return;
    }
    redirecting.current = true;
    window.location.assign(authorizeUrl);
  }, [isLoaded, isSignedIn, request]);

  if (!request) {
    return (
      <StandalonePage>
        <StandalonePageHeader
          context={m(invalidLinkMessage.context)}
          title={m(invalidLinkMessage.title)}
          description={m(invalidLinkMessage.description)}
        />
      </StandalonePage>
    );
  }

  const bridgeActive = !loadFailed && (!isLoaded || isSignedIn);

  return (
    <StandalonePage>
      <StandalonePageHeader
        context={gt("Browser authorization")}
        title={gt("Connecting your terminal")}
        description={
          isSignedIn
            ? gt("Redirecting to authorize T3 Connect for your CLI…")
            : gt("Sign in to continue authorizing T3 Connect for your CLI.")
        }
      />
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/25 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-background text-foreground">
            <TerminalIcon className="size-3.5" aria-hidden />
          </span>
          <span className="text-xs font-medium text-foreground">
            <T>Terminal CLI</T>
          </span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span
            ref={observeVisibleAnimation}
            data-slot="pairing-bridge-dot"
            data-active={bridgeActive ? "true" : "false"}
            className="size-1.5 rounded-full bg-primary"
          />
          <span
            ref={observeVisibleAnimation}
            data-slot="pairing-bridge-dot"
            data-active={bridgeActive ? "true" : "false"}
            className="size-1.5 rounded-full bg-primary"
          />
          <span
            ref={observeVisibleAnimation}
            data-slot="pairing-bridge-dot"
            data-active={bridgeActive ? "true" : "false"}
            className="size-1.5 rounded-full bg-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">T3 Connect</span>
          <span className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-background text-foreground">
            <CloudIcon className="size-3.5" aria-hidden />
          </span>
        </div>
      </div>
      {loadFailed ? (
        <div className="mt-6">
          <Button type="button" onClick={retryClerkLoad}>
            <T>Retry sign-in</T>
          </Button>
        </div>
      ) : isLoaded && !isSignedIn ? (
        <div className="mt-6">
          <Button type="button" onClick={openSignIn}>
            <T>Sign in</T>
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2.5 text-xs text-muted-foreground">
          <Spinner size="sm" tone="muted" />
          <span>{isSignedIn ? gt("Authorizing…") : gt("Preparing sign-in…")}</span>
        </div>
      )}
    </StandalonePage>
  );
}
