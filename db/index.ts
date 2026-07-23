import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Check wrangler.jsonc and apply the database migrations before starting the app."
    );
  }

  return drizzle(env.DB, { schema });
}
