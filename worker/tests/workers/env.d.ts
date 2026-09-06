/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { Env as LedgeEnv } from "../../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends LedgeEnv {}
  }
}
