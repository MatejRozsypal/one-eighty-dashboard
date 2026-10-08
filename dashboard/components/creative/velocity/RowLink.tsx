"use client";

/**
 * A table row that opens a page. The first cell carries a real link for
 * keyboard and screen readers; the row click is the mouse shortcut.
 */

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr onClick={() => router.push(href)} className="cursor-pointer transition-colors hover:bg-gray-50">
      {children}
    </tr>
  );
}
