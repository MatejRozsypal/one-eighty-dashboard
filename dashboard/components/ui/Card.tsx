/**
 * Card — the base surface.
 *
 * Ported from the design system's `components/surfaces/Card.jsx`. Two changes
 * from the handoff version, both deliberate:
 *
 *  1. Hover is pure CSS rather than React state, so this stays a server
 *     component. The handoff used `useState` for the lift, which would force
 *     every card — and therefore every page that renders one — into the client
 *     bundle for an effect CSS already does.
 *  2. Styling is Tailwind classes bound to the same tokens, not inline styles,
 *     so variants compose with utility overrides at call sites.
 *
 * Brand rule it encodes: hairline border first, soft shadow second. `inverse` is
 * the dark "product/proof" surface; `interactive` lifts −3px on hover.
 */

import type { ElementType, ReactNode } from "react";

type Variant = "default" | "subtle" | "inverse" | "outline";
type Padding = "none" | "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  default: "bg-surface-card text-content-body border-hairline shadow-sm",
  subtle: "bg-surface-card-subtle text-content-body border-hairline",
  inverse:
    "bg-surface-card-inverse text-content-inverse border-hairline-inverse shadow-lg",
  outline: "bg-transparent text-content-body border-hairline-strong",
};

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export interface CardProps {
  variant?: Variant;
  padding?: Padding;
  interactive?: boolean;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

export function Card({
  variant = "default",
  padding = "md",
  interactive = false,
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: CardProps & Record<string, unknown>) {
  return (
    <Tag
      className={[
        "rounded-card border",
        VARIANTS[variant],
        PADDING[padding],
        interactive &&
          "cursor-pointer transition-[transform,box-shadow] duration-base ease-out hover:-translate-y-[3px] hover:shadow-lg",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
