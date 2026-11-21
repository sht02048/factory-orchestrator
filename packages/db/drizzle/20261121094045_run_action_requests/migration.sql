CREATE TABLE `run_action_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_run_id` text,
	`handled_at` integer NOT NULL,
	CONSTRAINT `fk_run_action_requests_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_action_requests_once` ON `run_action_requests` (`run_id`,`request_id`);