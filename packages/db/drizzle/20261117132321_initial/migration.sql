CREATE TABLE `auto_assign_labels` (
	`workspace_id` text NOT NULL,
	`tracker_connection_id` text NOT NULL,
	`label_id` text NOT NULL,
	CONSTRAINT `auto_assign_labels_pk` PRIMARY KEY(`workspace_id`, `tracker_connection_id`),
	CONSTRAINT `fk_auto_assign_labels_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_auto_assign_labels_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`)
);
--> statement-breakpoint
CREATE TABLE `code_host_connections` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`secrets` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "code_host_connections_config_json" CHECK(json_valid("config"))
);
--> statement-breakpoint
CREATE TABLE `log_tail_requests` (
	`run_id` text PRIMARY KEY,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`lines` text,
	`error` text,
	CONSTRAINT `fk_log_tail_requests_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "log_tail_requests_lines_json" CHECK("lines" IS NULL OR json_valid("lines"))
);
--> statement-breakpoint
CREATE TABLE `mappings` (
	`tracker_connection_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`runner_project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	CONSTRAINT `mappings_pk` PRIMARY KEY(`tracker_connection_id`, `tracker_project_id`),
	CONSTRAINT `fk_mappings_tracker_connection_id_tracker_project_id_workspace_tracker_projects_tracker_connection_id_tracker_project_id_fk` FOREIGN KEY (`tracker_connection_id`,`tracker_project_id`) REFERENCES `workspace_tracker_projects`(`tracker_connection_id`,`tracker_project_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `run_state_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`changed_at` integer NOT NULL,
	CONSTRAINT `fk_run_state_changes_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `runner_check_requests` (
	`runner_id` text PRIMARY KEY,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`result` text,
	`error` text,
	CONSTRAINT `fk_runner_check_requests_runner_id_runners_id_fk` FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON DELETE CASCADE,
	CONSTRAINT "runner_check_requests_result_json" CHECK("result" IS NULL OR json_valid("result"))
);
--> statement-breakpoint
CREATE TABLE `runner_projects` (
	`runner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`display_name` text NOT NULL,
	`setup_state` text NOT NULL,
	CONSTRAINT `runner_projects_pk` PRIMARY KEY(`runner_id`, `project_id`),
	CONSTRAINT `fk_runner_projects_runner_id_runners_id_fk` FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `runners` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`capacity` integer NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`checked_at` integer,
	`check_error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "runners_config_json" CHECK(json_valid("config")),
	CONSTRAINT "runners_capacity" CHECK("capacity" >= 1),
	CONSTRAINT "runners_online" CHECK("online" IN (0, 1)),
	CONSTRAINT "runners_check_error_json" CHECK("check_error" IS NULL OR json_valid("check_error"))
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`tracker_connection_id` text NOT NULL,
	`ticket_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`runner_project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`branch` text NOT NULL,
	`state` text NOT NULL,
	`runner_id` text,
	`assigned_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`worktree_ref` text,
	`retry_token` text,
	`agent_result` text,
	`pr_state` text,
	`pr_id` text,
	`pr_display_id` text,
	`pr_url` text,
	`pr_ci_state` text,
	`pr_checked_at` integer,
	`later_pr_state` text,
	`later_pr_state_at` integer,
	`worktree_removed_at` integer,
	`tracker_state_set_at` integer,
	`tracker_comment_id` text,
	`tracker_commented_at` integer,
	`unreachable_since` integer,
	`last_log` text,
	CONSTRAINT `fk_runs_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`),
	CONSTRAINT `fk_runs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_runs_runner_id_runners_id_fk` FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`),
	CONSTRAINT "runs_state" CHECK("state" IN ('queued', 'running', 'waiting-for-input', 'disconnected', 'ended')),
	CONSTRAINT "runs_agent_result" CHECK("agent_result" IN ('exited-normally', 'exited-with-error', 'timed-out', 'stopped-waiting-for-input', 'runner-disconnected', 'worktree-missing')),
	CONSTRAINT "runs_pr_state" CHECK("pr_state" IN ('none', 'open', 'merged', 'closed')),
	CONSTRAINT "runs_later_pr_state" CHECK("later_pr_state" IN ('merged', 'closed')),
	CONSTRAINT "runs_last_log_json" CHECK("last_log" IS NULL OR json_valid("last_log")),
	CONSTRAINT "runs_started_iff_not_queued" CHECK(("state" = 'queued') = ("started_at" IS NULL)),
	CONSTRAINT "runs_runner_and_worktree_once_started" CHECK("state" = 'queued' OR ("runner_id" IS NOT NULL AND "worktree_ref" IS NOT NULL)),
	CONSTRAINT "runs_ended_at_iff_ended" CHECK(("state" = 'ended') = ("ended_at" IS NOT NULL)),
	CONSTRAINT "runs_agent_result_iff_ended" CHECK(("state" = 'ended') = ("agent_result" IS NOT NULL)),
	CONSTRAINT "runs_pr_state_iff_ended" CHECK(("state" = 'ended') = ("pr_state" IS NOT NULL)),
	CONSTRAINT "runs_later_pr_state_ended" CHECK("later_pr_state" IS NULL OR "state" = 'ended')
);
--> statement-breakpoint
CREATE TABLE `tracker_connections` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`secrets` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "tracker_connections_config_json" CHECK(json_valid("config"))
);
--> statement-breakpoint
CREATE TABLE `tracker_events` (
	`tracker_connection_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`kind` text NOT NULL,
	`tracker_project_id` text,
	`ticket_key` text,
	`label_ids` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	CONSTRAINT `tracker_events_pk` PRIMARY KEY(`tracker_connection_id`, `delivery_id`),
	CONSTRAINT `fk_tracker_events_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`),
	CONSTRAINT "tracker_events_label_ids_json" CHECK("label_ids" IS NULL OR json_valid("label_ids"))
);
--> statement-breakpoint
CREATE TABLE `workspace_tracker_projects` (
	`tracker_connection_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`in_progress_state_id` text,
	CONSTRAINT `workspace_tracker_projects_pk` PRIMARY KEY(`tracker_connection_id`, `tracker_project_id`),
	CONSTRAINT `fk_workspace_tracker_projects_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`),
	CONSTRAINT `fk_workspace_tracker_projects_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`max_run_ms` integer DEFAULT 7200000 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "workspaces_max_run_ms" CHECK("max_run_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX `run_state_changes_run` ON `run_state_changes` (`run_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_one_active_per_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`) WHERE "runs"."state" <> 'ended';--> statement-breakpoint
CREATE INDEX `runs_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_state` ON `runs` (`state`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_workspace` ON `runs` (`workspace_id`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `tracker_events_unprocessed` ON `tracker_events` (`received_at`) WHERE "tracker_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_tracker_projects_workspace` ON `workspace_tracker_projects` (`workspace_id`);