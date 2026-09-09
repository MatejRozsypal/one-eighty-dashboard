"use client";

/**
 * The list of concept cards, and the one ad detail panel they share.
 *
 * ── Why a wrapper exists at all ────────────────────────────────────────────
 * A concept card carries a strip of the creatives inside it, and the strip is
 * the obvious way in: a concept reading 1.25 is a question, and the answer is
 * always in the four thumbnails beside the number. Opening one needs client
 * state, and the Concepts screen is a server component — so the state lives
 * here, one panel for the whole list rather than one per card.
 *
 * The panel is the same component the Creatives grid opens, so an ad looks the
 * same however you arrived at it. Two panels that drifted apart would be two
 * different accounts of the same ad.
 */

import { useState } from "react";
import { AdDetail } from "@/components/creative/AdDetail";
import { ConceptCard, type ConceptCardData } from "@/components/creative/ConceptCard";
import type { AdView } from "@/lib/creative/view";

export function ConceptList({
  cards,
  currency,
  clientId,
}: {
  cards: ConceptCardData[];
  currency: string;
  clientId: string;
}) {
  const [open, setOpen] = useState<AdView | null>(null);

  return (
    <>
      {cards.map((c) => (
        <ConceptCard key={c.key} data={c} currency={currency} onOpenAd={setOpen} />
      ))}

      {open && (
        <AdDetail
          ad={open}
          currency={currency}
          clientId={clientId}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
