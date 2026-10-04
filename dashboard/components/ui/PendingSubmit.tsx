"use client";

/**
 * A submit button that pulses while its form's server action is in flight.
 *
 * `useFormStatus` reads the nearest parent `<form>`, so this must sit inside
 * the form it belongs to. The button is disabled while pending, which also
 * stops a second click from submitting twice. The pulse is the shared one
 * (`oe-pulse`, app/globals.css).
 */

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

export function PendingSubmit({
  className = "",
  disabled,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={`${className} ${pending ? "oe-pulse" : ""}`}
    />
  );
}
