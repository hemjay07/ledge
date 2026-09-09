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
        Measured from the pons launch factory <span className="addr">{numberFile.factory}</span>
        <br />
        Data and code: <a href={REPO_URL}>github.com/hemjay07/ledge</a> ·{" "}
        <Link href="/method">Method</Link> · <Link href="/cohorts">Cohorts</Link> ·{" "}
        <Link href="/number">Card</Link> · <a href="/number.json">number.json</a>
      </p>
      {/* CONSTRAINTS 10. Their documentation asks that references write the name
          in lowercase and link back to the app, and forbids implying official
          status without a written agreement. Saying so plainly also strengthens
          the independence the numbers rest on, so it belongs on every page
          rather than only on /method. */}
      <p className="foot-text disclaim">
        LEDGE is independent. It is not affiliated with, endorsed by, or operated by Pons Labs, LLC.
        It reads public chain data and publishes what it counts. <a href="https://ponsfamily.com">pons</a>
      </p>
    </footer>
  );
}

export { ColophonStrip };
