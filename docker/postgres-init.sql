-- Runs once, on first initialisation of the data volume.
--
-- The Postgres image creates POSTGRES_DB for us; this adds the throwaway
-- database used by `pnpm test:db`, plus an isolated restore-drill target.
-- The publishing setup creates Payload's database only when that profile is
-- selected. The test database name must contain "test" — the test harness
-- refuses to truncate anything else.
CREATE DATABASE sushi_test OWNER sushi;
CREATE DATABASE sushi_restore_drill OWNER sushi;
