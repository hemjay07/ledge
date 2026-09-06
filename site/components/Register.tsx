import type { ReactElement, ReactNode } from "react";
import { LedgerEntry } from "./LedgerEntry";

export interface RegisterCell {
  text: string;
  /** "fig" for a figure, "n" for the denominator column, "thin" for no figure */
  kind?: "fig" | "n" | "thin";
}

export interface RegisterRow {
  label: string;
  cells: RegisterCell[];
}

export interface RegisterProps {
  /** column heads; one of them must carry "(n)" or the table does not build */
  columns: string[];
  rows: RegisterRow[];
  /** the All footing: how a reader checks the buckets sum to the population */
  foot: RegisterRow;
  caption: string;
  ariaLabel: string;
  /** when given, the table is wrapped as a numbered entry in the register */
  folio?: string;
  heading?: string;
  headingNote?: ReactNode;
  headingId?: string;
  note?: ReactNode;
}

function cellClass(kind: RegisterCell["kind"]): string {
  if (kind === "thin") return "thin";
  if (kind === "n") return "fig n";
  return "fig";
}

export function Register(props: RegisterProps): ReactElement {
  const { columns, rows, foot, caption, ariaLabel, folio, heading, headingNote, headingId, note } =
    props;

  /* The denominator rule, enforced structurally: a rate column cannot stand
     without a sample-size column beside it. */
  if (!columns.some((c) => c.includes("(n)"))) {
    throw new Error(
      `LEDGE: register "${ariaLabel}" has no sample-size column. ` +
        "A rate does not render without its denominator.",
    );
  }

  const table = (
    <div className="scroller" tabIndex={0} role="group" aria-label={ariaLabel}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td className={cellClass(cell.kind)} key={columns[i + 1] ?? i}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{foot.label}</th>
            {foot.cells.map((cell, i) => (
              <td className={cellClass(cell.kind ?? "fig")} key={columns[i + 1] ?? i}>
                {cell.text}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (folio === undefined || heading === undefined || headingId === undefined) {
    return (
      <>
        {table}
        {note ? <p className="note note--fine">{note}</p> : null}
      </>
    );
  }

  return (
    <LedgerEntry folio={folio} heading={heading} headingNote={headingNote} id={headingId}>
      {table}
      {note ? <p className="note note--fine">{note}</p> : null}
    </LedgerEntry>
  );
}
