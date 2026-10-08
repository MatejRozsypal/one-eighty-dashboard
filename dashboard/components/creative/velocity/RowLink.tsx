"use client";

/**
 * A table row that opens a page. The first cell carries a real link for
 * keyboard and screen readers; the row click is the mouse shortcut.
 *
 * The click goes through the shared navigation (`useNavigation`), like every
 * link in the app, so the progress bar and the page pulse start on the click.
 */

import type { ReactNode } from "react";
import { useNavigation } from "@/components/shell/NavigationPending";

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const { navigate } = useNavigation();
  return (
    <tr onClick={() => navigate(href)} className="cursor-pointer transition-colors hover:bg-gray-50">
      {children}
    </tr>
  );
}
