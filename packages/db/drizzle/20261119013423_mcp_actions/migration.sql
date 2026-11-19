CREATE TABLE `mcp_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`at` integer NOT NULL,
	`client` text NOT NULL,
	`tool` text NOT NULL,
	`target` text,
	`run_id` text,
	`outcome` text NOT NULL,
	`reason` text,
	CONSTRAINT `fk_mcp_actions_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "mcp_actions_outcome" CHECK("outcome" IN ('done', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE `install_settings` ADD `mcp_write_allowed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `mcp_actions_run` ON `mcp_actions` (`run_id`,`at`);--> statement-breakpoint
CREATE INDEX `mcp_actions_at` ON `mcp_actions` (`at`);