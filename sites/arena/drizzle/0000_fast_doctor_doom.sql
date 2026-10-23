CREATE TABLE `arena_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`tournament_id` integer NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_owner_tournament` ON `arena_audit` (`owner`,`tournament_id`);--> statement-breakpoint
CREATE TABLE `state_documents` (
	`owner` text NOT NULL,
	`key` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_owner_key` ON `state_documents` (`owner`,`key`);--> statement-breakpoint
CREATE TABLE `state_revisions` (
	`owner` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
