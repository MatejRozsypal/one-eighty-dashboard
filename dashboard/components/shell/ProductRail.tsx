"use client";

/**
 * The icon rail — the outermost column, one icon per product.
 *
 * Always visible, never collapsible. It is the only way back to the other two
 * products, so hiding it behind the same toggle that hides the nav panel would
 * make a section of the app unreachable. The panel beside it collapses instead.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { productsFor, productFor, type ProductId } from "@/lib/products";
import { NavCollapseToggle } from "@/components/shell/NavCollapseToggle";

function Icon({ id }: { id: ProductId }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "chat")
    // A spark, not a speech bubble: the section is an agent, and a bubble would
    // read as team chat — which this is not.
    return (
      <svg {...common}>
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
    );
  if (id === "analytics")
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <rect x="5" y="11" width="3.4" height="6" rx="1" />
        <rect x="10.3" y="6" width="3.4" height="11" rx="1" />
        <rect x="15.6" y="13" width="3.4" height="4" rx="1" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="8.8" cy="9.6" r="1.6" />
      <path d="M20.5 15.2l-4.3-4.1L6 19.5" />
    </svg>
  );
}

export function ProductRail({ isInternal }: { isInternal: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const active = productFor(pathname);
  const products = productsFor(isInternal);

  return (
    <aside className="sticky top-0 hidden h-screen w-[var(--rail-w)] flex-none flex-col items-center border-r border-white/[0.07] bg-bg-inverse pb-[18px] pt-[22px] lg:flex">
      {/*
        The collapse control lives in one of two places and the rail reserves
        the top slot for it either way. Open, it sits at the panel's right edge
        beside the logo; closed, the panel is gone and it lands here, at the
        same height, on the other side of where the panel was — so it crosses a
        short gap rather than jumping to the far bottom corner, which is where
        it used to go and why it read as a different control.

        The slot keeps its height when empty so the icons below never move.
      */}
      <div className="flex h-7 w-full items-center justify-center">
        <span className="nav-when-collapsed">
          <NavCollapseToggle variant="rail" />
        </span>
      </div>

      <div className="mt-[22px] flex flex-col items-center gap-1">
      {products.map((p) => {
        const isActive = p.id === active;
        return (
          <Link
            key={p.id}
            // The query string carries client, range and currency. Dropping it
            // when switching products would silently reset whose numbers you
            // were looking at.
            href={qs ? `${p.href}?${qs}` : p.href}
            title={`${p.label} — ${p.hint}`}
            aria-label={p.label}
            aria-current={isActive ? "page" : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-sm transition-colors duration-fast ${
              isActive
                ? "bg-growth-500/[0.16] text-growth-300"
                : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-250"
            }`}
          >
            <Icon id={p.id} />
          </Link>
        );
      })}
      </div>
    </aside>
  );
}
