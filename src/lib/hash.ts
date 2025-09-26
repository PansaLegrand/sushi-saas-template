import { SnowflakeIdv1 } from "simple-flakeid";

const workerId = Number.parseInt(
  process.env.SNOWFLAKE_WORKER_ID ?? "1",
  10
);

const snowflake = new SnowflakeIdv1({
  workerId: Number.isNaN(workerId) ? 1 : workerId,
});

export function getSnowId(): string {
  const id = snowflake.NextId();
  return typeof id === "bigint" ? id.toString() : String(id);
}
