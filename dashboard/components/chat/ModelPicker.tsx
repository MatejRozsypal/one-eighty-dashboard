"use client";

/**
 * Which model answers: Opus or Sonnet, as a pair of pills under the box.
 *
 * One component for the Assistant composer and the Home box, reading and
 * writing the one choice in `ChatSession`, so picking Sonnet on Home is still
 * Sonnet on the Assistant and the next visit remembers it in either place.
 *
 * Shown only when `/api/chat/status` says the real assistant answers this
 * person. Offering a choice of model to someone whose question no model will
 * answer would be a control that does nothing.
 */

import { useEffect } from "react";
import { useChatSession } from "@/components/chat/ChatSession";
import { CHAT_MODELS } from "@/lib/chat/models";

export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const { live, checkLive, model, pickModel } = useChatSession();

  useEffect(() => checkLive(), [checkLive]);

  if (!live) return null;

  return (
    <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Model">
      {CHAT_MODELS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={model === m.id}
          title={m.hint}
          disabled={disabled}
          onClick={() => pickModel(m.id)}
          className={`rounded-full px-[10px] py-[3px] text-[12px] transition-colors duration-fast ${
            model === m.id
              ? "bg-surface-card font-semibold text-content-strong shadow-sm"
              : "text-content-muted hover:text-content-body"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
