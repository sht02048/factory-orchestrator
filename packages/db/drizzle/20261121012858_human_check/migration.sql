ALTER TABLE `run_questions` ADD `kind` text DEFAULT 'question' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_run_questions` (
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`kind` text DEFAULT 'question' NOT NULL,
	`body` text NOT NULL,
	`options` text NOT NULL,
	`asked_at` integer NOT NULL,
	`answer` text,
	`answered_at` integer,
	`answer_sent_at` integer,
	CONSTRAINT `run_questions_pk` PRIMARY KEY(`run_id`, `question_id`),
	CONSTRAINT `fk_run_questions_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "run_questions_kind" CHECK("kind" IN ('question', 'human-check')),
	CONSTRAINT "run_questions_options_json" CHECK(json_valid("options")),
	CONSTRAINT "run_questions_answered" CHECK(("answer" IS NULL) = ("answered_at" IS NULL)),
	CONSTRAINT "run_questions_sent_after_answer" CHECK("answer_sent_at" IS NULL OR "answer" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_run_questions`(`run_id`, `question_id`, `body`, `options`, `asked_at`, `answer`, `answered_at`, `answer_sent_at`) SELECT `run_id`, `question_id`, `body`, `options`, `asked_at`, `answer`, `answered_at`, `answer_sent_at` FROM `run_questions`;--> statement-breakpoint
DROP TABLE `run_questions`;--> statement-breakpoint
ALTER TABLE `__new_run_questions` RENAME TO `run_questions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_events` (
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
INSERT INTO `__new_notification_events`(`id`, `seq`, `kind`, `cause`, `run_id`, `workspace_id`, `ticket_key`, `runner_id`, `subject`, `detail`, `created_at`, `resolved_at`) SELECT `id`, `seq`, `kind`, `cause`, `run_id`, `workspace_id`, `ticket_key`, `runner_id`, `subject`, `detail`, `created_at`, `resolved_at` FROM `notification_events`;--> statement-breakpoint
DROP TABLE `notification_events`;--> statement-breakpoint
ALTER TABLE `__new_notification_events` RENAME TO `notification_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `run_questions_unsent` ON `run_questions` (`answered_at`) WHERE "run_questions"."answer" IS NOT NULL AND "run_questions"."answer_sent_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_seq` ON `notification_events` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_open_cause` ON `notification_events` (`cause`) WHERE "notification_events"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX `notification_events_resolved` ON `notification_events` (`resolved_at`);