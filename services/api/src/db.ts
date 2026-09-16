import postgres, { type Sql } from "postgres";

/** One connection pool per process. `postgres` returns tagged-template queries; use `sql.json()` for jsonb params. */
export function connect(url: string): Sql {
  return postgres(url, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 5,
    transform: { undefined: null },
  });
}
export type Db = Sql;

/** Quick reachability probe used by tests to skip when no database is available. */
export async function reachable(url: string): Promise<boolean> {
  const sql = connect(url);
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
