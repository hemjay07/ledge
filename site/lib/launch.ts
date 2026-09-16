import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/* data/launch.json: LEDGE's own launch, as a fact file the site reads at
   build time. Before the launch it carries the pre-registration's commit;
   the moment the token exists its address goes in and the homepage slot
   turns into "LEDGE, measured by LEDGE" (TODO C3). Nothing here is
   derived; the two dates and the hash are typed in when they are known. */
export const launchSchema = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/)
    .nullable(),
  launchAt: z.string().nullable(),
  preregistrationCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  preregistrationCommittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type Launch = z.infer<typeof launchSchema>;

export function readLaunch(dataDir = join(process.cwd(), "..", "data")): Launch | null {
  const path = join(dataDir, "launch.json");
  if (!existsSync(path)) return null;
  const parsed = launchSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error("LEDGE: data/launch.json does not match its schema.\n" + JSON.stringify(parsed.error.issues, null, 2));
  }
  return parsed.data;
}
