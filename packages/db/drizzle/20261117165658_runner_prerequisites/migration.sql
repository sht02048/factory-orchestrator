ALTER TABLE `runners` ADD `prerequisites` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runners` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`capacity` integer NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`assignment_blocked` integer DEFAULT false NOT NULL,
	`prerequisites` text,
	`mailbox_ref` text,
	`checked_at` integer,
	`check_error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "runners_config_json" CHECK(json_valid("config")),
	CONSTRAINT "runners_capacity" CHECK("capacity" >= 1),
	CONSTRAINT "runners_online" CHECK("online" IN (0, 1)),
	CONSTRAINT "runners_assignment_blocked" CHECK("assignment_blocked" IN (0, 1)),
	CONSTRAINT "runners_check_error_json" CHECK("check_error" IS NULL OR json_valid("check_error")),
	CONSTRAINT "runners_prerequisites_json" CHECK("prerequisites" IS NULL OR json_valid("prerequisites"))
);
--> statement-breakpoint
INSERT INTO `__new_runners`(`id`, `kind`, `name`, `config`, `capacity`, `online`, `assignment_blocked`, `mailbox_ref`, `checked_at`, `check_error`, `created_at`) SELECT `id`, `kind`, `name`, `config`, `capacity`, `online`, `assignment_blocked`, `mailbox_ref`, `checked_at`, `check_error`, `created_at` FROM `runners`;--> statement-breakpoint
DROP TABLE `runners`;--> statement-breakpoint
ALTER TABLE `__new_runners` RENAME TO `runners`;--> statement-breakpoint
PRAGMA foreign_keys=ON;