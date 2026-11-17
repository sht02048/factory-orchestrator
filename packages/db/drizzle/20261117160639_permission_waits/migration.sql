CREATE TABLE `run_permission_waits` (
	`run_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`detail` text NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	`deny_reason` text,
	`denied_at` integer,
	`deny_sent_at` integer,
	CONSTRAINT `run_permission_waits_pk` PRIMARY KEY(`run_id`, `permission_id`),
	CONSTRAINT `fk_run_permission_waits_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "run_permission_waits_denied" CHECK(("deny_reason" IS NULL) = ("denied_at" IS NULL)),
	CONSTRAINT "run_permission_waits_sent_after_deny" CHECK("deny_sent_at" IS NULL OR "denied_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `run_permission_waits_unsent` ON `run_permission_waits` (`denied_at`) WHERE "run_permission_waits"."denied_at" IS NOT NULL AND "run_permission_waits"."deny_sent_at" IS NULL;