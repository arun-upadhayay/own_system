import { sql, type Kysely } from 'kysely'

/**
 * Executes an ordered list of single SQL statements.
 *
 * One statement per call, deliberately: Kysely runs statements through the
 * extended (prepared) protocol, which does not allow multiple commands in one
 * string. Splitting also makes a failure point to the exact statement. The SQL
 * here mirrors docs/architecture/04-erd.md closely enough to diff against it.
 */
export async function run(db: Kysely<unknown>, statements: string[]): Promise<void> {
  for (const statement of statements) {
    const trimmed = statement.trim()
    if (trimmed.length > 0) {
      await sql.raw(trimmed).execute(db)
    }
  }
}
