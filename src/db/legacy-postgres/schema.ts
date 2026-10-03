/**
 * Source-only PostgreSQL catalog for export/audit tooling and legacy migrations.
 * Application code must import ../schema (the D1 schema), never this module.
 */
export * from '../schema/enums';
export * from '../schema/core';
export * from '../schema/calendar';
export * from '../schema/rules';
export * from '../schema/flow';
export * from '../schema/live';
export * from '../schema/results';
export * from '../schema/extraccion';
export * from '../schema/vigencia';
export * from '../schema/fie';
export * from '../schema/sport';
export * from '../schema/cron';
export * from '../schema/sport-import';
