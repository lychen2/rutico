import { describe, expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import { createSidebarListMotion, triggerSidebarDragRipple } from "./Sidebar.motion";

describe("sidebar list motion", () => {
  it("slides rows above a removal at the bottom instead of jumping with the scroll clamp", async () => {
    await using screen = await render(null);
    const viewport = document.createElement("div");
    viewport.dataset.slot = "scroll-area-viewport";
    viewport.style.cssText = "height: 200px; overflow-y: auto; overflow-anchor: none";
    const list = document.createElement("ul");
    list.style.cssText = "position: relative; margin: 0; padding: 0; list-style: none";
    const rows = Array.from({ length: 10 }, () => {
      const row = document.createElement("li");
      row.style.height = "64px";
      list.append(row);
      return row;
    });
    viewport.append(list);
    screen.container.append(viewport);
    const motion = createSidebarListMotion(list);
    using _motion = { [Symbol.dispose]: () => motion.dispose() };
    motion.update(false);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    const above = rows[7]!;
    const before = above.getBoundingClientRect().top;

    rows[8]!.remove();
    motion.update(true);
    for (const animation of above.getAnimations()) animation.pause();

    expect(above.getBoundingClientRect().top).toBe(before);
  });

  it("uses the workbench curve on FLIP moves and subtle scale(0.985) on exiting ghosts", async () => {
    await using screen = await render(null);
    const list = document.createElement("ul");
    list.style.cssText = "position: relative; margin: 0; padding: 0; list-style: none";
    const first = document.createElement("li");
    first.style.height = "40px";
    first.dataset.sidebarMotionKey = "first";
    const second = document.createElement("li");
    second.style.height = "40px";
    second.dataset.sidebarMotionKey = "second";
    list.append(first, second);
    screen.container.append(list);

    const motion = createSidebarListMotion(list);
    using _motion = { [Symbol.dispose]: () => motion.dispose() };
    motion.update(false);

    first.remove();
    motion.update(true);

    const canonicalWorkbenchEase = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const moveAnimation = second.getAnimations()[0];
    expect(moveAnimation?.effect?.getTiming().easing).toBe(canonicalWorkbenchEase);

    const ghost = list.querySelector<HTMLElement>('[data-sidebar-motion-exit="first"]');
    expect(ghost).not.toBeNull();
    const exitEffect = ghost!.getAnimations()[0]?.effect as KeyframeEffect | undefined;
    expect(exitEffect?.getTiming().easing).toBe(canonicalWorkbenchEase);
    const keyframes = exitEffect?.getKeyframes() ?? [];
    expect(keyframes[keyframes.length - 1]?.transform).toContain("scale(0.985)");
  });

  it("triggers Tip 005 damped spring neighbor ripple (A * 0.7^n, 24ms * n stagger) on drag-over", async () => {
    await using screen = await render(null);
    const list = document.createElement("ul");
    list.style.cssText = "position: relative; margin: 0; padding: 0; list-style: none";
    const rows = Array.from({ length: 7 }, (_, index) => {
      const row = document.createElement("li");
      row.style.height = "36px";
      row.dataset.threadItem = `thread-${index}`;
      list.append(row);
      return row;
    });
    screen.container.append(list);

    const rippled = triggerSidebarDragRipple(list, "thread-3", 1);
    expect(rippled).toBe(6);

    const nearAnimation = rows[4]!.getAnimations()[0];
    const farAnimation = rows[5]!.getAnimations()[0];
    expect(nearAnimation?.effect?.getTiming().delay).toBe(24);
    expect(farAnimation?.effect?.getTiming().delay).toBe(48);
    expect(rows[3]!.getAnimations()).toHaveLength(0);
  });
});
