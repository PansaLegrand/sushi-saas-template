import * as migration_20260802_164641_initial_content_platform from './20260802_164641_initial_content_platform';
import * as migration_20260803_014612_marketing_email from './20260803_014612_marketing_email';
import * as migration_20260803_035353 from './20260803_035353';
import * as migration_20261005_024231_payload_security_fields from './20261005_024231_payload_security_fields';

export const migrations = [
  {
    up: migration_20260802_164641_initial_content_platform.up,
    down: migration_20260802_164641_initial_content_platform.down,
    name: '20260802_164641_initial_content_platform',
  },
  {
    up: migration_20260803_014612_marketing_email.up,
    down: migration_20260803_014612_marketing_email.down,
    name: '20260803_014612_marketing_email',
  },
  {
    up: migration_20260803_035353.up,
    down: migration_20260803_035353.down,
    name: '20260803_035353',
  },
  {
    up: migration_20261005_024231_payload_security_fields.up,
    down: migration_20261005_024231_payload_security_fields.down,
    name: '20261005_024231_payload_security_fields'
  },
];
