/**
 * Logo lock-up — brand mark + "OneEighty" wordmark.
 *
 * The mark is a PNG shipped in the design handoff. Per the brand guide it must
 * not be redrawn, so it's used as-is; only the wordmark is set in type.
 */

import Image from "next/image";

export function Logo({
  tone = "ink",
  markOnly = false,
  size = 28,
}: {
  tone?: "ink" | "inverse";
  markOnly?: boolean;
  size?: number;
}) {
  const inverse = tone === "inverse";

  return (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src={inverse ? "/brand/oneeighty-mark-white.png" : "/brand/oneeighty-mark.png"}
        alt="One Eighty"
        width={size}
        height={size}
        priority
        className="block h-auto"
        style={{ width: size }}
      />
      {!markOnly && (
        <span
          className={`text-[19px] tracking-[-0.02em] ${
            inverse ? "text-content-inverse" : "text-content-strong"
          }`}
        >
          <span className="font-normal">One</span>
          <span className="font-bold">Eighty</span>
        </span>
      )}
    </span>
  );
}
