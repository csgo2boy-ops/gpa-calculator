# Supabase safety tests — gpa-tracker-test only

## Execution report (2026-10-23)

- PR migration and old T1–T10 plan: code reviewed at b3c4d28.
- T4 true/true → false/false: user-reported result, not independently reproduced.
- T2–T9 SQL behavior and T10 concurrency: NOT RUN. No test connection settings supplied; local Docker engine unavailable.
- SQL role/claims tests below do not verify Supabase HTTP/JWT signatures, gateway or API settings.
- Missing configuration exits nonzero with “database tests NOT RUN”; no database PASS results are generated.
- Locally executed: JavaScript syntax check, missing-config refusal, and npm test **107/107** (including two target-guard tests). These are not database integration passes.

## Quick start

Requires Node.js 20+. No PostgreSQL CLI installation required.

1. Obtain the PR branch and run npm ci.
2. In **gpa-tracker-test** SQL Editor, execute supabase/migrations/001a_rpc_execute_permissions.sql. This idempotent follow-up fixes only the two RPC ACLs. Do not re-run the original schema.
3. Copy supabase/tests/db-test.example.json to repository root as db-test.local.json.
4. From test Dashboard → Connect → **Session pooler**, copy host, port **5432**, database, user; fill in test projectRef and database password locally. Direct db.<ref>.supabase.co:5432, user postgres, also works if IPv6 is available.
5. Verify the reference belongs to **gpa-tracker-test**. Host/user/ref consistency is checked, but the connection cannot prove a Dashboard display name. Never put production settings here.
6. Run: npm run test:db
7. Return only db-test-report.local.json and terminal PASS/FAIL lines. Never send the credential file.

The config, recovery manifest and report are gitignored. The connection requires permission to create disposable auth.users, reapply 001 inside a rollback, SET ROLE authenticated/anon and inspect blocking PIDs. Use the database postgres connection; API keys are insufficient. TLS certificate verification remains enabled.

## Assertions

- **T2:** all three UID indexes reject duplicates with SQLSTATE 23505/exact index name; different users can reuse UID.
- **T3:** legacy data lacking state is backfilled to revision 1; another revision 7 is preserved; empty user gets no state. Reapply actual 001 twice and compare exact UUID sets, not just counts.
- **T4:** current effective anon EXECUTE false, authenticated true; actual anon calls rejected (42501). Regression grants anon+PUBLIC, reapplies 001 twice, then checks effective permissions and PUBLIC ACL entries. All deliberate grants roll back.
- **T5:** both A→B and B→A across all four tables: SELECT hides rows, UPDATE/DELETE affect zero, forged INSERT/ownership reassignment fail (42501). Own read/update/delete succeeds; trigger/RPC cases cover own inserts.
- **T6:** caller-supplied year-2000 updated_at must be replaced by transaction_timestamp() on INSERT and UPDATE, on all three tables. now() is constant inside BEGIN: old “after > before” expectation was incorrect.
- **T8:** null/omitted revision raises the exact required-revision error. Full data and state snapshots stay unchanged, including rollback of a newly initialized state row.
- **T7/T9:** snapshot shape and isolation, success, stale conflict, ignored forged user_id, rejected null identity; late assessment NOT NULL failure restores earlier deletes/inserts and revision. B stays unchanged.
- **T10:** two separate pg clients must have distinct backend PIDs. A retains its lock after writing; B starts with the same revision. Observer must actually see pg_blocking_pids(B) contain A. A different authenticated read sees the old complete snapshot before commit. After A commits, B returns conflict/current_revision=1; all three tables contain only A's complete winning payload. Execute once with existing state and once without state.

T2–T9 use BEGIN/finally ROLLBACK, with savepoints for expected errors. Temporary fixtures, ACL changes and migration reapplications roll back. Migration reapplication takes schema locks: only use the dedicated test project with other tests/migrations idle.

T10 cannot use a single all-enclosing rollback while proving a committed winner. It commits only a randomly generated disposable auth user and that user's fixtures, then deletes the exact UUID+generated email and verifies cascading cleanup. No existing user's snapshot is replaced.

A recovery manifest is saved BEFORE T10 creates a committed user. If forcibly interrupted or cleanup fails, keep db-test-recovery.local.json and run:

    npm run test:db -- --cleanup

Cleanup targets only the recorded UUID/email on the same project reference and verifies auth.users plus all four tables are empty for that UUID. Never delete the manifest before successful cleanup. A failed or cleanup-FAILED run is not a pass.

## Code-review limits

- Authenticated users can directly write their own tables, including UPDATE/DELETE of gpa_user_state.revision. Optimistic concurrency protects clients following the RPC contract; it does not protect against bypass through permitted direct writes. Tightening this requires a separate permissions/RPC design.
- The base schema lacks parent relational foreign keys for semester_local_id/course_local_id. RLS and snapshot atomicity do not establish full parent/child integrity.
- Real PostgREST/JWT verification remains separate from PostgreSQL role/claims simulation.
- User-reported prior T1–T9 results are not independent verification.

## References

- [PostgreSQL transaction timestamps](https://www.postgresql.org/docs/current/functions-datetime.html)
- [PostgreSQL blocking PIDs](https://www.postgresql.org/docs/current/functions-info.html)
- [Supabase function permissions](https://supabase.com/docs/guides/database/functions)
- [node-postgres transactions](https://node-postgres.com/features/transactions)

