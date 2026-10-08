/**
 * The Assistant page's frame, shared by the page, its loading state and the
 * Home handoff stage (components/chat/HandoffStage.tsx), which has to lay the
 * conversation out exactly where the page will, or the hand-over shows.
 *
 * Desktop: the full viewport height, with the top kept clear for the fixed
 * account menu. Phone: the space between the sticky bar (with its 1rem
 * shoulder) and the bottom edge, taking back the foot padding the shell gives
 * every page, since the composer carries its own `--safe-bottom`.
 *
 * A literal class string, and under components/, so Tailwind's scanner (which
 * reads app/ and components/ only) sees every class.
 */
export const CHAT_FRAME =
  "flex h-[calc(100dvh-var(--header-h)-1rem)] min-h-0 flex-col -mb-[calc(1.5rem+var(--safe-bottom))] lg:mb-0 lg:h-[100dvh] lg:pt-[var(--header-h)]";
