CREATE TABLE `notification_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`cause` text NOT NULL,
	`run_id` text,
	`workspace_id` text,
	`ticket_key` text,
	`runner_id` text,
	`subject` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	CONSTRAINT `fk_notification_events_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_events_runner_id_runners_id_fk` FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notification_events_kind" CHECK("kind" IN ('question', 'permission', 'human-check', 'failed', 'disconnected', 'runner-offline', 'runner-auth', 'runner-usage-limit')),
	CONSTRAINT "notification_events_target" CHECK(("run_id" IS NULL) <> ("runner_id" IS NULL) AND ("run_id" IS NULL) = ("workspace_id" IS NULL) AND ("run_id" IS NULL) = ("ticket_key" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `notification_sequence` (
	`id` integer PRIMARY KEY,
	`last` integer NOT NULL,
	CONSTRAINT "notification_sequence_single" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_seq` ON `notification_events` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_open_cause` ON `notification_events` (`cause`) WHERE "notification_events"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX `notification_events_resolved` ON `notification_events` (`resolved_at`);