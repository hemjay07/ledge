"use client";

/* One labelled control in a board's filter row, in ConfigGrid.tsx's own
   `.picker-*` vocabulary (`.picker-field`, `.picker-label`, `.picker-line`,
   `.picker-select`, `.picker-caret`) rather than a second visual language
   for what is structurally the same kind of field: a label, a select, a
   printed caret. Named after the column it filters -- CONSTRAINTS 1: a
   filter is not a ranking and must never read as a recommendation, and a
   generic column name ("Pair token", "Creator tax") is what keeps it from
   reading as a preset with a verdict baked into its name. */

import { useId, type ReactElement } from "react";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}): ReactElement {
  const id = useId();
  return (
    <p className="picker-field">
      <label className="picker-label" htmlFor={id}>
        {label}
      </label>
      <span className="picker-line">
        <select
          className="picker-select mono"
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="picker-caret" aria-hidden="true">
          ▾
        </span>
      </span>
    </p>
  );
}

/** A numeric bound, in the field's own unit (seconds, everywhere it is used
    here). Empty text is "no bound" -- never coerced to 0, which would filter
    every row out rather than none. */
export function FilterNumber({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
}): ReactElement {
  const id = useId();
  return (
    <p className="picker-field">
      <label className="picker-label" htmlFor={id}>
        {label}
      </label>
      <span className="picker-line">
        <input
          className="picker-select mono"
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </p>
  );
}

export function FilterDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const id = useId();
  return (
    <p className="picker-field">
      <label className="picker-label" htmlFor={id}>
        {label}
      </label>
      <span className="picker-line">
        <input
          className="picker-select mono"
          id={id}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </p>
  );
}
