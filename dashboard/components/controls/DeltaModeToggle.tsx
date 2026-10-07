"use client";

/**
 * "% | 123": how every change on the page is shown, percent or absolute.
 *
 * Sits beside Compare (control bar, Reports filter bar) and is hidden when
 * Compare is None, since there is no change to show. One toggle for the whole
 * app: the mode lives in `DeltaModeProvider` (URL `delta`, cookie default).
 * It answers on click with no server render; see the provider's header.
 * Drawn at the control bar's pill height, so it sits flush beside the pills.
 */

import { SegmentPills } from "@/components/controls/SegmentedControl";
import { useDeltaModeControl } from "@/components/ui/DeltaMode";
import { parseDeltaMode } from "@/lib/format";

export function DeltaModeToggle() {
  const { mode, setMode } = useDeltaModeControl();
  return (
    <SegmentPills
      size="bar"
      ariaLabel="Change shown as"
      shown={mode}
      onSelect={(value) => {
        const next = parseDeltaMode(value);
        if (next) setMode(next);
      }}
      segments={[
        { value: "pct", label: "%", title: "Percent change" },
        { value: "abs", label: "123", title: "Absolute change" },
      ]}
    />
  );
}
