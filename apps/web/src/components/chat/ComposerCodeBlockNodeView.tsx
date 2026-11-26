import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useGT } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { languageOfInfoString, withInfoStringLanguage } from "~/composer-code-languages";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { isMacPlatform } from "~/lib/utils";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { MarkdownCodeBlockFrame } from "./MarkdownCodeBlock";
import { ComposerCodeBlockLanguagePicker } from "./ComposerCodeBlockLanguagePicker";

export function ComposerCodeBlockNodeView({
  node,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps) {
  const gt = useGT();
  const resolvedTheme = useRenderedAppearance();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1400 });
  const info = typeof node.attrs.language === "string" ? node.attrs.language : "";
  const language = languageOfInfoString(info);
  const exitShortcut = isMacPlatform(navigator.platform) ? "⌘↵" : "Ctrl↵";

  const changeLanguage = (next: string) => {
    updateAttributes({ language: withInfoStringLanguage(info, next) });
    const position = getPos();
    if (typeof position === "number") {
      editor
        .chain()
        .focus(position + 1 + node.content.size)
        .run();
    }
  };

  return (
    <MarkdownCodeBlockFrame
      as={NodeViewWrapper}
      language={language || "text"}
      fenceTitle={null}
      theme={resolvedTheme}
      frameProps={{ "data-composer-code-studio": "true" }}
      headerProps={{ contentEditable: false }}
      title={
        <ComposerCodeBlockLanguagePicker
          language={language}
          theme={resolvedTheme}
          disabled={!editor.isEditable}
          onChange={changeLanguage}
        />
      }
      actions={
        <div
          contentEditable={false}
          data-composer-code-studio-actions="true"
          className="flex shrink-0 items-center gap-1"
        >
          {editor.isEditable ? (
            <span
              data-composer-code-studio-hint="true"
              className="hidden items-center gap-1 text-3xs text-muted-foreground/75 sm:inline-flex"
              aria-hidden="true"
            >
              <Kbd variant="outline">{exitShortcut}</Kbd>
            </span>
          ) : null}
          <SharedTooltipTrigger
            label={isCopied ? gt("Copied") : gt("Copy code")}
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label={isCopied ? gt("Copied") : gt("Copy code")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => copyToClipboard(node.textContent)}
              >
                {isCopied ? (
                  <CheckIcon className="size-3 text-success" aria-hidden="true" />
                ) : (
                  <CopyIcon className="size-3" aria-hidden="true" />
                )}
              </Button>
            }
          />
        </div>
      }
    >
      <div className="chat-markdown-shiki">
        <pre className="max-w-full overflow-x-auto px-3 pt-1 pb-2">
          <NodeViewContent<"code">
            as="code"
            className="block min-h-[1lh] font-mono whitespace-pre-wrap text-inherit [overflow-wrap:anywhere]"
          />
        </pre>
      </div>
    </MarkdownCodeBlockFrame>
  );
}
