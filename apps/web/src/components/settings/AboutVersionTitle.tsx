import { msg, T, useGT } from "gt-react";
import { CheckIcon } from "lucide-react";

import { APP_VERSION } from "../../branding";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function AboutVersionTitle() {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    timeout: 1500,
    target: {
      target: "version",
      unavailableMessage: msg("Clipboard API is unavailable while copying version."),
      failureMessage: msg("Failed to copy version to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy version"),
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>
        <T>Version</T>
      </span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            closeOnClick={false}
            render={
              <InlineButton
                tone="muted"
                aria-label={gt("Copy version {version}", { version: APP_VERSION })}
                onClick={() => copyToClipboard(APP_VERSION, undefined)}
              >
                <span>{APP_VERSION}</span>
                {isCopied ? (
                  <CheckIcon
                    aria-hidden="true"
                    className="t3-icon-pop ms-0.5 size-3 text-success"
                  />
                ) : null}
              </InlineButton>
            }
          />
          <TooltipPopup>{isCopied ? <T>Copied</T> : <T>Copy version</T>}</TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}
