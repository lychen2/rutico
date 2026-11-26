import { toHtml } from "hast-util-to-html";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { cloneElement, isValidElement, memo, type DOMAttributes } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import type { highlightCodeToHast } from "../../lib/incrementalHighlighting";

type HighlightedRoot = ReturnType<typeof highlightCodeToHast>;
type HighlightedNode = HighlightedRoot["children"][number];
const runtime = { Fragment, jsx, jsxs };

function elementShell(node: Extract<HighlightedNode, { type: "element" }>) {
  const element = toJsxRuntime({ ...node, children: [] }, runtime);
  if (!isValidElement<DOMAttributes<HTMLElement>>(element)) {
    throw new Error("Expected a highlighted code element");
  }
  return element;
}

const HighlightedLine = memo(function HighlightedLine({
  node,
  streamingLine = false,
  activeTailLine = false,
}: {
  node: HighlightedNode;
  streamingLine?: boolean;
  activeTailLine?: boolean;
}) {
  if (node.type !== "element") return toJsxRuntime(node, runtime);
  return cloneElement(elementShell(node), {
    ...(streamingLine ? { "data-code-line-enter": "true" } : {}),
    ...(activeTailLine ? { "data-code-active-line": "true" } : {}),
    dangerouslySetInnerHTML: { __html: toHtml({ type: "root", children: node.children }) },
  } as DOMAttributes<HTMLElement>);
});

/** Preserve completed lines' DOM to avoid reparsing unchanged tokens. */
export function HighlightedCodeLines({
  root,
  streaming = false,
}: {
  root: HighlightedRoot;
  streaming?: boolean;
}) {
  const pre = root.children[0];
  if (pre?.type !== "element" || pre.tagName !== "pre") return toJsxRuntime(root, runtime);
  const code = pre.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return toJsxRuntime(root, runtime);
  let lastElementIndex = -1;
  if (streaming) {
    for (let index = code.children.length - 1; index >= 0; index -= 1) {
      if (code.children[index]?.type === "element") {
        lastElementIndex = index;
        break;
      }
    }
  }
  return cloneElement(
    elementShell(pre),
    undefined,
    cloneElement(
      elementShell(code),
      undefined,
      code.children.map((node, index) => (
        <HighlightedLine
          // Appending tokens and lines preserves line positions.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          node={node}
          streamingLine={streaming}
          activeTailLine={streaming && index === lastElementIndex}
        />
      )),
    ),
  );
}
