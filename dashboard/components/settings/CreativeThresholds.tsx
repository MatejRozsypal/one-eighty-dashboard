/**
 * The Creative Engine's thresholds, on the Settings screen.
 *
 * Grouped into three blocks that answer three different questions, because they
 * are edited at different times by different people:
 *
 *   The lines      what counts as winning and losing. Set with the client at
 *                  kickoff, and moved almost never.
 *   Reading        how much evidence the tool demands before it will answer.
 *                  Set once and left alone, see the warning on max interval.
 *   The pack       how creative testing is funded and paced.
 *
 * Everything derived is shown as derived rather than as an empty box: the two
 * budget floors are 2x and 0.5x CPA unless overridden, and printing the derived
 * value in the placeholder means nobody has to remember the multiplier.
 */

import { SaveButton } from "@/components/settings/SaveButton";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
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
        {hint && (
          <>
            {" "}
            <InfoTip text={hint} label={`About ${label}`} />
          </>
        )}
      </span>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        placeholder={placeholder ?? NO_VALUE}
        defaultValue={value === null || value === undefined ? "" : String(value)}
        className={FIELD}
      />
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
  /**
   * The Meta ad account's currency, not the shop's: every amount in this form
   * is compared with Meta spend. For a client whose shop sells in EUR and whose
   * ad account bills in CZK, a CPA typed here is CZK.
   */
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
        <div className="flex flex-wrap items-start gap-3">
          <Field name="killRoas" label="Kill ROAS" value={settings.killRoas}
                 hint="Below this, every sale loses money." />
          <Field name="targetRoas" label="Target ROAS" value={settings.targetRoas} />
          <Field name="targetCpa" label={`Target CPA (${currency})`} value={settings.targetCpa}
                 hint="In the Meta ad account currency. Gates spend; the hit rate does not use it." />
          <Field name="breakEvenRoas" label="Break-even ROAS" value={settings.breakEvenRoas}
                 hint="1 / margin. Often below the kill line, because Meta over-reports." />
          <Field name="grossMarginPct" label="Gross margin %"
                 value={settings.grossMargin === null ? null : +(settings.grossMargin * 100).toFixed(1)}
                 hint="Contribution margin is hidden without it." />
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          Evidence needed
        </legend>
        <div className="flex flex-wrap items-start gap-3">
          <Field name="readPurchases" label="Read at" value={settings.readPurchases}
                 hint="Purchases before a row is Read confidence. Also the shrinkage weight." />
          <Field name="directionalPurchases" label="Directional at" value={settings.directionalPurchases}
                 hint="Below this a row is greyed and hatched." />
          <Field name="maxCiHalfWidthPct" label="Max interval %"
                 value={+(settings.maxCiHalfWidth * 100).toFixed(0)}
                 hint={`Currently ${needed} purchases to read a tag to this precision. Set once per client.`} />
          <Field name="hookRateFloorPct" label="Hook rate floor %"
                 value={+(settings.hookRateFloor * 100).toFixed(1)} />
          <Field name="holdRateFloorPct" label="Hold rate floor %"
                 value={+(settings.holdRateFloor * 100).toFixed(1)} />
        </div>
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
                 />
          <Field name="perAdFloorDaily" label={`Per-ad floor / day (${currency})`}
                 value={settings.perAdFloorDaily}
                 placeholder={derivedFloor === null ? "0.5× CPA" : `${derivedFloor} (0.5× CPA)`} />
          <Field name="monthlyBudget" label={`Monthly budget (${currency})`}
                 value={settings.monthlyBudget}
                 placeholder="from delivery" />
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
