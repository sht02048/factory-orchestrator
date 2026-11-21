CREATE TABLE `run_blockers` (
	`run_id` text NOT NULL,
	`blocker_key` text NOT NULL,
	`title` text NOT NULL,
	`state_name` text NOT NULL,
	`state_category` text NOT NULL,
	`in_cycle` integer DEFAULT false NOT NULL,
	`read_at` integer NOT NULL,
	CONSTRAINT `run_blockers_pk` PRIMARY KEY(`run_id`, `blocker_key`),
	CONSTRAINT `fk_run_blockers_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `ticket_priority` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `blockers_read_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `blockers_read_failed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `wait_skipped_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `wait_skip_request_id` text;--> statement-breakpoint
CREATE INDEX `run_blockers_key` ON `run_blockers` (`blocker_key`);