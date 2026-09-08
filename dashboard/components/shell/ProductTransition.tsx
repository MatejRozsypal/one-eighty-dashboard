"use client";

/**
 * A short cross-fade when the rail changes product.
 *
 * Keyed on the product, not the path: moving between Analytics pages must not
 * animate — those are steps inside one place and a fade on every click would
 * be the "invasive" thing, not the cure for it. Switching section is a change
 * of context and is the only move worth marking.
 *
 * Kept to a fade and 6px of travel over 200ms. The brand rule is calm and no
 * bounce, and the reduced-motion block in `globals.css` removes it entirely
 * for anyone who has asked the OS for that.
 */

import { usePathname } from "next/navigation";
import { productFor } from "@/lib/products";

export function ProductTransition({ children }: { children: React.ReactNode }) {
  const product = productFor(usePathname());

  // The key is what replays the animation: React remounts the subtree when it
  // changes, and leaves it alone when it does not.
  return (
    <div key={product} className="product-enter flex min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}
