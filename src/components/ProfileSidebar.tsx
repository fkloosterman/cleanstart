/**
 * Profile sidebar (WP1.6, design §4.7, D1).
 *
 * A registry-driven view of the session profile: grouped slots with
 * their values, preference stances, and the still-blank unknowns, each
 * with a provenance affordance. Every value is inline-editable — a
 * correction writes `provenance: "edited"` through `applyPatches`
 * (the caller's `onEdit`), so it outranks later extraction (edited-wins).
 *
 * The same component serves guest and signed-in users; only the data
 * adapter behind `onEdit` differs (localStorage vs the `sessions` row).
 * Layout follows D1: a persistent right-hand panel on desktop; on
 * smaller screens a summary chip row that opens a slide-over sheet.
 */

import { useState } from "react";
import { Pencil, Plus, X, Check } from "lucide-react";
import {
  buildSidebarModel,
  enumOptionLabel,
  slotEditor,
  STANCE_LABELS,
  STANCE_ORDER,
  humanizeEntity,
  type SidebarField,
} from "@/lib/profile/sidebar";
import type { ProfilePatch } from "@/lib/profile/patches";
import type { Preference, Provenance, SessionProfile, SlotName } from "@/lib/profile/registry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EditFn = (patches: ProfilePatch[]) => void;

const PROVENANCE_META: Record<Provenance, { label: string; dot: string }> = {
  stated: { label: "You told us this", dot: "bg-primary" },
  edited: { label: "You edited this", dot: "bg-primary" },
  inferred: { label: "Inferred from the conversation", dot: "bg-muted-foreground/40" },
  propagated: { label: "Remembered from a previous session", dot: "bg-amber-400" },
};

function ProvenanceDot({ field }: { field: SidebarField }) {
  if (!field.provenance) return null;
  const meta = PROVENANCE_META[field.provenance];
  const lowConfidence = field.confidence === "low" && field.provenance !== "edited";
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        meta.dot,
        lowConfidence && "opacity-50",
      )}
      title={lowConfidence ? `${meta.label} · not yet confirmed` : meta.label}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// Editors (each returns the patches for a correction; all use provenance
// "edited" so they win over extraction)

function EnumEditor({
  field,
  options,
  onEdit,
  onDone,
}: {
  field: SidebarField;
  options: string[];
  onEdit: EditFn;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{field.label}</p>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => {
            onEdit([{ op: "set", slot: field.slot, value: opt, provenance: "edited" }]);
            onDone();
          }}
          className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          {enumOptionLabel(field.slot, opt)}
        </button>
      ))}
      {field.filled && (
        <button
          type="button"
          onClick={() => {
            onEdit([{ op: "clear", slot: field.slot, provenance: "edited" }]);
            onDone();
          }}
          className="mt-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function RegionEditor({
  field,
  profile,
  onEdit,
  onDone,
}: {
  field: SidebarField;
  profile: SessionProfile;
  onEdit: EditFn;
  onDone: () => void;
}) {
  const current = (profile.region.value ?? {}) as { state?: string; city?: string; zip?: string };
  const [city, setCity] = useState(current.city ?? "");
  const [state, setState] = useState(current.state ?? "");

  const save = () => {
    const trimmedState = state.trim();
    const trimmedCity = city.trim();
    if (!trimmedState && !trimmedCity) {
      onEdit([{ op: "clear", slot: "region", provenance: "edited" }]);
      onDone();
      return;
    }
    if (trimmedState.length < 2) return; // region schema requires a state
    onEdit([
      {
        op: "set",
        slot: "region",
        // Preserve the zip we already hold — it's used for content matching
        // but never shown (§4.8).
        value: { state: trimmedState, city: trimmedCity || undefined, zip: current.zip },
        provenance: "edited",
      },
    ]);
    onDone();
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
      <Input
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="City"
        className="h-8"
      />
      <Input
        value={state}
        onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
        placeholder="State (e.g. MA)"
        className="h-8"
      />
      <Button size="sm" onClick={save} className="mt-1">
        Save
      </Button>
    </div>
  );
}

function TextListEditor({
  field,
  profile,
  onEdit,
  onDone,
}: {
  field: SidebarField;
  profile: SessionProfile;
  onEdit: EditFn;
  onDone: () => void;
}) {
  const raw = (profile[field.slot].value ?? []) as unknown[];
  const [draft, setDraft] = useState("");
  const isTopics = field.slot === "topics_discussed";

  const labelOf = (entry: unknown): string =>
    isTopics ? String(entry) : ((entry as { text?: string }).text ?? String(entry));

  const removeAt = (index: number) => {
    const next = raw.filter((_, i) => i !== index);
    onEdit([{ op: "set", slot: field.slot, value: next, provenance: "edited" }]);
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const entry: unknown = isTopics ? text : { text };
    onEdit([{ op: "append", slot: field.slot, value: entry, provenance: "edited" }]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
      {raw.length > 0 && (
        <ul className="flex flex-col gap-1">
          {raw.map((entry, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-sm"
            >
              <span className="min-w-0 truncate">{labelOf(entry)}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Remove"
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={isTopics ? "Add a topic…" : "Add…"}
          className="h-8"
        />
        <Button size="sm" variant="outline" onClick={add} aria-label="Add">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="self-end text-xs text-muted-foreground hover:text-foreground"
      >
        Done
      </button>
    </div>
  );
}

function PreferencesEditor({
  field,
  profile,
  onEdit,
  onDone,
}: {
  field: SidebarField;
  profile: SessionProfile;
  onEdit: EditFn;
  onDone: () => void;
}) {
  const prefs = (profile.preferences.value ?? []) as Preference[];

  const setStance = (pref: Preference, stance: Preference["stance"]) => {
    onEdit([
      {
        op: "append", // upserts by entity
        slot: "preferences",
        value: { entity: pref.entity, stance, note: pref.note, provenance: "edited" },
        provenance: "edited",
      },
    ]);
  };

  const remove = (entity: string) => {
    const next = prefs.filter((p) => p.entity !== entity);
    onEdit([{ op: "set", slot: "preferences", value: next, provenance: "edited" }]);
  };

  if (prefs.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing here yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
      {prefs.map((pref) => (
        <div
          key={pref.entity}
          className="flex flex-col gap-1.5 border-b border-border pb-2 last:border-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{humanizeEntity(pref.entity)}</span>
            <button
              type="button"
              onClick={() => remove(pref.entity)}
              aria-label="Remove"
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {STANCE_ORDER.map((stance) => (
              <button
                key={stance}
                type="button"
                onClick={() => setStance(pref, stance)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  pref.stance === stance
                    ? "border-primary bg-primary-light text-primary-dark"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {STANCE_LABELS[stance]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={onDone}
        className="self-end text-xs text-muted-foreground hover:text-foreground"
      >
        Done
      </button>
    </div>
  );
}

function FieldEditor({
  field,
  profile,
  onEdit,
  onDone,
}: {
  field: SidebarField;
  profile: SessionProfile;
  onEdit: EditFn;
  onDone: () => void;
}) {
  const editor = slotEditor(field.slot as SlotName);
  switch (editor.kind) {
    case "enum":
      return <EnumEditor field={field} options={editor.options} onEdit={onEdit} onDone={onDone} />;
    case "region":
      return <RegionEditor field={field} profile={profile} onEdit={onEdit} onDone={onDone} />;
    case "text-list":
      return <TextListEditor field={field} profile={profile} onEdit={onEdit} onDone={onDone} />;
    case "preferences":
      return <PreferencesEditor field={field} profile={profile} onEdit={onEdit} onDone={onDone} />;
    case "readonly":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Value rendering

function FieldValue({ field }: { field: SidebarField }) {
  if (!field.value) {
    return (
      <span className="text-sm text-muted-foreground/60">
        {field.askedUnknown ? "Not sure yet" : "—"}
      </span>
    );
  }
  if (field.value.type === "scalar") {
    return <span className="text-sm text-foreground">{field.value.text}</span>;
  }
  if (field.value.type === "list") {
    return (
      <div className="flex flex-wrap gap-1">
        {field.value.items.map((item, i) => (
          <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
            {item}
          </span>
        ))}
      </div>
    );
  }
  // stances
  return (
    <div className="flex flex-col gap-1.5">
      {field.value.groups.map((group) => (
        <div key={group.stance} className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1">
            {group.entries.map((entry) => (
              <span
                key={entry.entity}
                title={entry.note}
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  group.stance === "ruled_out"
                    ? "bg-destructive/10 text-destructive line-through"
                    : "bg-primary-light text-primary-dark",
                )}
              >
                {entry.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldRow({
  field,
  profile,
  onEdit,
}: {
  field: SidebarField;
  profile: SessionProfile;
  onEdit: EditFn;
}) {
  const [open, setOpen] = useState(false);
  const editable = slotEditor(field.slot as SlotName).kind !== "readonly";

  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
          <ProvenanceDot field={field} />
        </div>
        <FieldValue field={field} />
      </div>
      {editable && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Edit ${field.label}`}
              // Always visible (not hover-gated) so the affordance is
              // discoverable and reachable on touch devices; it darkens on
              // hover / when its popover is open.
              className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 transition hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              {field.filled ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <FieldEditor
              field={field}
              profile={profile}
              onEdit={onEdit}
              onDone={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content + responsive shell

export function ProfileSidebarContent({
  profile,
  onEdit,
}: {
  profile: SessionProfile;
  onEdit: EditFn;
}) {
  const model = buildSidebarModel(profile);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">What we know about you</h2>
      </div>
      {model.map((group) => (
        <div key={group.group} className="flex flex-col">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {group.label}
          </h3>
          <div className="divide-y divide-border/60">
            {group.fields.map((field) => (
              <div key={field.slot} className="group">
                <FieldRow field={field} profile={profile} onEdit={onEdit} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        Edits you make here are kept as-is — the assistant won't overwrite them.
      </p>
    </div>
  );
}

/** A compact chip summary of filled scalar slots — the mobile trigger row. */
function summaryChips(profile: SessionProfile): { slot: string; text: string }[] {
  return buildSidebarModel(profile)
    .flatMap((g) => g.fields)
    .filter((f) => f.value?.type === "scalar")
    .map((f) => ({ slot: f.slot, text: (f.value as { text: string }).text }));
}

export function ProfilePanel({
  profile,
  onEdit,
  className,
}: {
  profile: SessionProfile;
  onEdit: EditFn;
  className?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const chips = summaryChips(profile);

  return (
    <>
      {/* Desktop: persistent right-hand panel */}
      <aside
        className={cn(
          "hidden w-72 shrink-0 self-start overflow-y-auto rounded-2xl border border-border bg-card p-4 lg:block",
          className,
        )}
      >
        <ProfileSidebarContent profile={profile} onEdit={onEdit} />
      </aside>

      {/* Mobile/tablet: chip row that opens a slide-over sheet. `order-first`
          floats it above the chat column when both stack in a flex-col. */}
      <div className="order-first mb-3 flex items-center gap-2 overflow-x-auto pt-4 lg:order-none lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" /> Your profile
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] overflow-y-auto sm:max-w-sm">
            <div className="mt-4">
              <ProfileSidebarContent profile={profile} onEdit={onEdit} />
            </div>
          </SheetContent>
        </Sheet>
        {chips.slice(0, 4).map((chip) => (
          <span
            key={chip.slot}
            className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
          >
            {chip.text}
          </span>
        ))}
      </div>
    </>
  );
}
