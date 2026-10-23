// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const revisions=sqliteTable('state_revisions',{owner:text('owner').primaryKey(),revision:integer('revision').notNull().default(0)});
export const documents=sqliteTable('state_documents',{owner:text('owner').notNull(),key:text('key').notNull(),payload:text('payload').notNull()},t=>[uniqueIndex('documents_owner_key').on(t.owner,t.key)]);
export const auditEvents=sqliteTable('arena_audit',{id:integer('id').primaryKey({autoIncrement:true}),owner:text('owner').notNull(),tournamentId:integer('tournament_id').notNull(),action:text('action').notNull(),details:text('details').notNull(),at:text('at').notNull()},t=>[index('audit_owner_tournament').on(t.owner,t.tournamentId)]);
