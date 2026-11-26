import { useStableCallback } from "../../hooks/useStableCallback";
import { useLayoutEffect, useRef } from "react";
import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import {
  DRAFT_HERO_AGENT_IGNITE_DELAY_RATIO,
  DRAFT_HERO_AGENT_IGNITE_OFFSET_PX,
  DRAFT_HERO_MESSAGE_ENTER_OFFSET_PX,
  DRAFT_HERO_MESSAGE_ENTER_SCALE,
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
} from "./draftHeroTransition";

export function useDraftHeroLayoutTransition(
  isDraftHeroState: boolean,
  animationsActive: boolean,
  animationDurationMs: number,
) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const stageLaunchCleanupRef = useRef<(() => void) | null>(null);
  const captureComposerRect = useStableCallback(() => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the committed composer rect and starts a FLIP Web Animation before paint
  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = composerAnchorRef.current?.getBoundingClientRect() ?? null;
    const wasDraftHero = previousStateRef.current;
    const stateChanged = wasDraftHero !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    for (const animation of animationsRef.current) {
      animation.cancel();
    }
    animationsRef.current = [];
    stageLaunchCleanupRef.current?.();
    stageLaunchCleanupRef.current = null;

    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      animationsActive &&
      !prefersReducedMotion() &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const activeAnimations: Animation[] = [];
      const spatialSpring = getSpringWaapiTiming("spatial");
      const snappySpring = getSpringWaapiTiming("snappy");
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const composerAnimation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: Math.max(animationDurationMs, Math.round(spatialSpring.duration * 0.85)),
            easing: spatialSpring.easing,
          },
        );
        composerAnimation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        activeAnimations.push(composerAnimation);
      }

      if (wasDraftHero && !isDraftHeroState) {
        const stageElement =
          transitionGroup.closest<HTMLElement>("[data-chat-workspace-drop-target]") ??
          transitionGroup.parentElement;
        if (stageElement) {
          stageElement.dataset.draftHeroLaunching = "true";
          stageLaunchCleanupRef.current = () => {
            delete stageElement.dataset.draftHeroLaunching;
          };
          const firstMessageBubble = stageElement.querySelector<HTMLElement>(
            "[data-user-message-bubble]",
          );
          if (firstMessageBubble && typeof firstMessageBubble.animate === "function") {
            const messageAnimation = firstMessageBubble.animate(
              [
                {
                  opacity: 0,
                  transform: `translate3d(0, ${DRAFT_HERO_MESSAGE_ENTER_OFFSET_PX}px, 0) scale(${DRAFT_HERO_MESSAGE_ENTER_SCALE})`,
                },
                {
                  opacity: 1,
                  transform: "translate3d(0, 0, 0) scale(1)",
                },
              ],
              {
                duration: Math.max(160, Math.round(animationDurationMs * 0.92)),
                easing: snappySpring.easing,
              },
            );
            messageAnimation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
            activeAnimations.push(messageAnimation);
          }

          const agentStartupElements = stageElement.querySelectorAll<HTMLElement>(
            '[data-timeline-row-kind="working"] > *, [data-timeline-row-kind="thinking"] > *, [data-timeline-row-kind="work-live"] > *, [data-timeline-row-kind="worktree-setup"] > *',
          );
          const baseDelay = Math.min(
            96,
            Math.round(animationDurationMs * DRAFT_HERO_AGENT_IGNITE_DELAY_RATIO),
          );
          for (const [index, element] of Array.from(agentStartupElements).entries()) {
            if (typeof element.animate !== "function") continue;
            const agentAnimation = element.animate(
              [
                {
                  opacity: 0,
                  transform: `translate3d(0, ${DRAFT_HERO_AGENT_IGNITE_OFFSET_PX}px, 0)`,
                },
                {
                  opacity: 1,
                  transform: "translate3d(0, 0, 0)",
                },
              ],
              {
                duration: Math.max(150, Math.round(animationDurationMs * 0.85)),
                delay: baseDelay + index * 32,
                easing: snappySpring.easing,
                fill: "backwards",
              },
            );
            agentAnimation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
            activeAnimations.push(agentAnimation);
          }
        }
      }

      if (activeAnimations.length > 0) {
        animationsRef.current = activeAnimations;
        const cleanupStageLaunch = stageLaunchCleanupRef.current;
        void Promise.all(
          activeAnimations.map((animation) => animation.finished.catch(() => undefined)),
        ).then(() => {
          if (animationsRef.current === activeAnimations) {
            animationsRef.current = [];
          }
          if (stageLaunchCleanupRef.current === cleanupStageLaunch) {
            cleanupStageLaunch?.();
            stageLaunchCleanupRef.current = null;
          }
        });
      } else if (stageLaunchCleanupRef.current) {
        stageLaunchCleanupRef.current();
        stageLaunchCleanupRef.current = null;
      }
    }
    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [animationDurationMs, animationsActive, isDraftHeroState]);

  return { transitionGroupRef, composerAnchorRef, captureComposerRect } as const;
}
