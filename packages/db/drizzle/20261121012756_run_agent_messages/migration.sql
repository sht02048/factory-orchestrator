CREATE TABLE `run_agent_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` text NOT NULL,
	`body` text NOT NULL,
	`requested_at` integer NOT NULL,
	`send_started_at` integer,
	`completed_at` integer,
	`error` text,
	CONSTRAINT `fk_run_agent_messages_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `run_agent_messages_run` ON `run_agent_messages` (`run_id`,`id`);--> statement-breakpoint
CREATE INDEX `run_agent_messages_pending` ON `run_agent_messages` (`id`) WHERE "run_agent_messages"."completed_at" IS NULL;