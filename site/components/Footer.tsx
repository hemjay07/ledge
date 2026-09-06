import type { ReactElement } from "react";
import Link from "next/link";
import { ColophonStrip } from "./ColophonStrip";
import { numberFile, REPO_URL } from "../lib/number";

export function Footer(): ReactElement {
  return (
    <footer>
      <div className="rule-heavy" />
      <div className="colophon">
        <span className="mark">LEDGE.TOOLS</span>
        <span className="stamp">
          Chain {numberFile.chainId} · Definitions {numberFile.definitionsVersion}
        </span>
      </div>
      <div className="rule-hair" />
      <p className="foot-text">
        Measured from PonsV2LaunchFactory <span className="addr">{numberFile.factory}</span>
        <br />
        Data and code: <a href={REPO_URL}>github.com/hemjay07/ledge</a> ·{" "}
        <Link href="/method">Method</Link> · <Link href="/cohorts">Cohorts</Link> ·{" "}
        <Link href="/number">Card</Link> · <a href="/number.json">number.json</a>
      </p>
    </footer>
  );
}

export { ColophonStrip };
