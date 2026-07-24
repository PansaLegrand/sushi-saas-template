-- Runs once, on first initialisation of the data volume.
--
-- The Postgres image creates POSTGRES_DB for us; this adds the throwaway
-- database used by `pnpm test:db`. Its name must contain "test" — the test
-- harness refuses to truncate anything else.
CREATE DATABASE sushi_test OWNER sushi;
