/**
 * The Creative Engine's thresholds, on the Settings screen.
 *
 * Grouped into three blocks that answer three different questions, because they
 * are edited at different times by different people:
 *
 *   The lines      what counts as winning and losing. Set with the client at
 *                  kickoff, and moved almost never.
 *   Reading        how much evidence the tool demands before it will answer.
 *                  Set once and left alone — see the warning on max interval.
 *   The pack       how creative testing is funded and paced.
 *
 * Everything derived is shown as derived rather than as an empty box: the two
 * budget floors are 2x and 0.5x CPA unless overridden, and printing the derived
 * value in the placeholder means nobody has to remember the multiplier.
 */

import { SaveButton } from "@/components/settings/SaveButton";
import type { StoredCreativeSettings } from "@/lib/creative/store";
import { purchasesForPrecision } from "@/lib/creative/stats";

const FIELD =
  "w-[120px] rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-right font-mono text-[12.5px]";

function Field({
  name,
  label,
  value,
  placeholder,
  hint,
}: {
  name: string;
  label: string;
  value: number | string | null | undefined;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
        {label}
      </span>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        placeholder={placeholder ?? "—"}
        defaultValue={value === null || value === undefined ? "" : String(value)}
        className={FIELD}
      />
      {hint && (
        <span className="max-w-[150px] text-[11px] leading-[1.45] text-content-muted">
          {hint}
        </span>
      )}
    </label>
  );
}

export function CreativeThresholds({
  clientId,
  currency,
  settings,
  action,
}: {
  clientId: string;
  currency: string;
  settings: StoredCreativeSettings;
  action: (formData: FormData) => Promise<void>;
}) {
  const cpa = settings.targetCpa;
  const derivedPack = cpa === null ? null : Math.round(cpa * 2);
  const derivedFloor = cpa === null ? null : Math.round(cpa * 0.5);
  const needed = purchasesForPrecision(settings.maxCiHalfWidth);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="clientId" value={clientId} />

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          The lines
        </legend>
        <p className="m-0 max-w-[74ch] text-[12.5px] leading-[1.6] text-content-muted">
          Until the kill line, the target and the CPA are all set, the Creative
          screens show delivery and refuse to issue a verdict. That is on
          purpose: a verdict computed against a guessed target looks exactly
          like one computed against yours.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <Field name="killRoas" label="Kill ROAS" value={settings.killRoas}
                 hint="Below this, every sale loses money." />
          <Field name="targetRoas" label="Target ROAS" value={settings.targetRoas} />
          <Field name="targetCpa" label={`Target CPA (${currency})`} value={settings.targetCpa} />
          <Field name="breakEvenRoas" label="Break-even ROAS" value={settings.breakEvenRoas}
                 hint="1 / margin. Often below the working kill line, because Meta over-reports." />
          <Field name="grossMarginPct" label="Gross margin %"
                 value={settings.grossMargin === null ? null : +(settings.grossMargin * 100).toFixed(1)}
                 hint="Contribution margin is hidden without it." />
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          How much evidence before it answers
        </legend>
        <div className="flex flex-wrap items-start gap-3">
          <Field name="readPurchases" label="Read at" value={settings.readPurchases}
                 hint="Purchases before a row is Read confidence. Also the shrinkage weight." />
          <Field name="directionalPurchases" label="Directional at" value={settings.directionalPurchases}
                 hint="Below this a row is greyed and hatched." />
          <Field name="maxCiHalfWidthPct" label="Max interval %"
                 value={+(settings.maxCiHalfWidth * 100).toFixed(0)}
                 hint={`Currently ${needed} purchases to read a tag to this precision.`} />
          <Field name="hookRateFloorPct" label="Hook rate floor %"
                 value={+(settings.hookRateFloor * 100).toFixed(1)} />
          <Field name="holdRateFloorPct" label="Hold rate floor %"
                 value={+(settings.holdRateFloor * 100).toFixed(1)} />
        </div>
        {/*
          The one setting with a standing warning attached. It decides how often
          the tool says "not separable" instead of giving an answer, which makes
          it the obvious thing to reach for when the answer is unwelcome.
        */}
        <p className="m-0 max-w-[74ch] border-l-2 border-warning pl-3.5 text-[12.5px] leading-[1.6] text-content-body">
          Max interval is the dial that decides how often this tool declines to
          answer. Set it once, per client, and do not move it to get the answer
          you wanted.
        </p>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          The pack
        </legend>
        <div className="flex flex-wrap items-start gap-3">
          <Field name="tier" label="Tier" value={settings.tier}
                 placeholder="SMALL / MID / LARGE" />
          <Field name="noTouchDays" label="No-touch days" value={settings.noTouchDays} />
          <Field name="testPurchases" label="Test size" value={settings.testPurchases}
                 hint="Purchases a pack must reach before its verdict means anything." />
          <Field name="minAdsetBudgetDaily" label={`Pack budget / day (${currency})`}
                 value={settings.minAdsetBudgetDaily}
                 placeholder={derivedPack === null ? "2× CPA" : `${derivedPack} (2× CPA)`}
                 hint="Empty uses 2× CPA, so a CPA correction moves it too." />
          <Field name="perAdFloorDaily" label={`Per-ad floor / day (${currency})`}
                 value={settings.perAdFloorDaily}
                 placeholder={derivedFloor === null ? "0.5× CPA" : `${derivedFloor} (0.5× CPA)`} />
          <Field name="monthlyBudget" label={`Monthly budget (${currency})`}
                 value={settings.monthlyBudget}
                 placeholder="from delivery"
                 hint="Empty is estimated from actual spend." />
          <Field name="packsPerMonthTarget" label="Packs / month" value={settings.packsPerMonthTarget} />
          <Field name="hooksPerBodyTarget" label="Hooks per body" value={settings.hooksPerBodyTarget} />
          <Field name="netNewSharePct" label="Net-new share %"
                 value={+(settings.netNewShareTarget * 100).toFixed(0)}
                 hint="The 80/20 rule: at most this share of production on new ideas." />
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <SaveButton />
        {settings.updatedAt && (
          <span className="font-mono text-[10.5px] text-content-muted">
            {settings.updatedAt.slice(0, 10)} · {settings.updatedBy}
          </span>
        )}
      </div>
    </form>
  );
}
