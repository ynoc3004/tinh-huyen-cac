DROP INDEX `documents_owner_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_owner_key` ON `state_documents` (`owner`,`key`);