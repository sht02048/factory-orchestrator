CREATE TABLE `run_cancel_requests` (
	`run_id` text PRIMARY KEY,
	`requested_at` integer NOT NULL,
	`processed_at` integer,
	CONSTRAINT `fk_run_cancel_requests_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `run_questions` (
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`body` text NOT NULL,
	`options` text NOT NULL,
	`asked_at` integer NOT NULL,
	`answer` text,
	`answered_at` integer,
	`answer_sent_at` integer,
	CONSTRAINT `run_questions_pk` PRIMARY KEY(`run_id`, `question_id`),
	CONSTRAINT `fk_run_questions_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "run_questions_options_json" CHECK(json_valid("options")),
	CONSTRAINT "run_questions_answered" CHECK(("answer" IS NULL) = ("answered_at" IS NULL)),
	CONSTRAINT "run_questions_sent_after_answer" CHECK("answer_sent_at" IS NULL OR "answer" IS NOT NULL)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runners` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`capacity` integer NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`assignment_blocked` integer DEFAULT false NOT NULL,
	`mailbox_ref` text,
	`checked_at` integer,
	`check_error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "runners_config_json" CHECK(json_valid("config")),
	CONSTRAINT "runners_capacity" CHECK("capacity" >= 1),
	CONSTRAINT "runners_online" CHECK("online" IN (0, 1)),
	CONSTRAINT "runners_assignment_blocked" CHECK("assignment_blocked" IN (0, 1)),
	CONSTRAINT "runners_check_error_json" CHECK("check_error" IS NULL OR json_valid("check_error"))
);
--> statement-breakpoint
INSERT INTO `__new_runners`(`id`, `kind`, `name`, `config`, `capacity`, `online`, `checked_at`, `check_error`, `created_at`) SELECT `id`, `kind`, `name`, `config`, `capacity`, `online`, `checked_at`, `check_error`, `created_at` FROM `runners`;--> statement-breakpoint
DROP TABLE `runners`;--> statement-breakpoint
ALTER TABLE `__new_runners` RENAME TO `runners`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY,
	`tracker_connection_id` text NOT NULL,
	`ticket_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`runner_project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`worktree_name` text NOT NULL,
	`branch` text,
	`state` text NOT NULL,
	`runner_id` text,
	`assigned_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`worktree_ref` text,
	`agent_ref` text,
	`retry_token` text,
	`start_requested_at` integer,
	`start_failures` integer DEFAULT 0 NOT NULL,
	`start_error` text,
	`agent_result` text,
	`pr_state` text,
	`runner_unreached` integer DEFAULT false NOT NULL,
	`report_body` text,
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
	CONSTRAINT "runs_agent_result" CHECK("agent_result" IN ('reported-success', 'reported-failure', 'ended-without-report', 'timed-out', 'stopped-waiting-for-input', 'runner-disconnected', 'worktree-missing', 'canceled', 'could-not-start')),
	CONSTRAINT "runs_pr_state" CHECK("pr_state" IN ('none', 'open', 'merged', 'closed')),
	CONSTRAINT "runs_later_pr_state" CHECK("later_pr_state" IN ('merged', 'closed')),
	CONSTRAINT "runs_last_log_json" CHECK("last_log" IS NULL OR json_valid("last_log")),
	CONSTRAINT "runs_runner_unreached" CHECK("runner_unreached" IN (0, 1)),
	CONSTRAINT "runs_queued_not_started" CHECK("state" <> 'queued' OR "started_at" IS NULL),
	CONSTRAINT "runs_active_started" CHECK("state" NOT IN ('running', 'waiting-for-input', 'disconnected') OR "started_at" IS NOT NULL),
	CONSTRAINT "runs_started_has_runner_worktree" CHECK("started_at" IS NULL OR ("runner_id" IS NOT NULL AND "worktree_ref" IS NOT NULL AND "branch" IS NOT NULL AND "agent_ref" IS NOT NULL)),
	CONSTRAINT "runs_not_started_ended" CHECK("state" <> 'ended' OR "started_at" IS NOT NULL OR ("agent_result" IN ('canceled', 'could-not-start') AND "pr_state" = 'none' AND "worktree_ref" IS NULL)),
	CONSTRAINT "runs_could_not_start_not_started" CHECK("agent_result" IS NULL OR "agent_result" <> 'could-not-start' OR "started_at" IS NULL),
	CONSTRAINT "runs_runner_unreached_canceled" CHECK("runner_unreached" = 0 OR ("agent_result" = 'canceled' AND "started_at" IS NOT NULL)),
	CONSTRAINT "runs_ended_at_iff_ended" CHECK(("state" = 'ended') = ("ended_at" IS NOT NULL)),
	CONSTRAINT "runs_agent_result_iff_ended" CHECK(("state" = 'ended') = ("agent_result" IS NOT NULL)),
	CONSTRAINT "runs_pr_state_iff_ended" CHECK(("state" = 'ended') = ("pr_state" IS NOT NULL)),
	CONSTRAINT "runs_later_pr_state_ended" CHECK("later_pr_state" IS NULL OR "state" = 'ended')
);
--> statement-breakpoint
-- 0037: 할당 때 정한 브랜치(factory/<키>-<n>)를 결정적 워크트리 이름으로 옮기고, 실제 브랜치는 시작한 런에만 남긴다.
-- 시작한 옛 런에는 에이전트 참조가 없어 워크트리 참조를 넣는다. 시작 결과를 모르던(retry_token이 있는) Queued 런은
-- 이미 보냈을 수 있으니 시작 요청 시각을 적어 다시 보내기 전에 같은 이름으로 찾게 한다. 종료 코드로 정하던 에이전트 결과는 완료 보고로 옮긴다(Q82.2).
INSERT INTO `__new_runs`(`id`, `tracker_connection_id`, `ticket_key`, `workspace_id`, `tracker_project_id`, `runner_project_id`, `agent_id`, `worktree_name`, `branch`, `state`, `runner_id`, `assigned_at`, `started_at`, `ended_at`, `worktree_ref`, `agent_ref`, `retry_token`, `start_requested_at`, `agent_result`, `pr_state`, `pr_id`, `pr_display_id`, `pr_url`, `pr_ci_state`, `pr_checked_at`, `later_pr_state`, `later_pr_state_at`, `worktree_removed_at`, `tracker_state_set_at`, `tracker_comment_id`, `tracker_commented_at`, `unreachable_since`, `last_log`) SELECT `id`, `tracker_connection_id`, `ticket_key`, `workspace_id`, `tracker_project_id`, `runner_project_id`, `agent_id`, replace(`branch`, '/', '-'), CASE WHEN `started_at` IS NULL THEN NULL ELSE `branch` END, `state`, `runner_id`, `assigned_at`, `started_at`, `ended_at`, `worktree_ref`, CASE WHEN `started_at` IS NULL THEN NULL ELSE `worktree_ref` END, `retry_token`, CASE WHEN `state` = 'queued' AND `retry_token` IS NOT NULL THEN `assigned_at` END, CASE `agent_result` WHEN 'exited-normally' THEN 'reported-success' WHEN 'exited-with-error' THEN 'reported-failure' ELSE `agent_result` END, `pr_state`, `pr_id`, `pr_display_id`, `pr_url`, `pr_ci_state`, `pr_checked_at`, `later_pr_state`, `later_pr_state_at`, `worktree_removed_at`, `tracker_state_set_at`, `tracker_comment_id`, `tracker_commented_at`, `unreachable_since`, `last_log` FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracker_events` (
	`tracker_connection_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`kind` text NOT NULL,
	`tracker_project_id` text,
	`ticket_key` text,
	`label_ids` text,
	`previous_label_ids` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	CONSTRAINT `tracker_events_pk` PRIMARY KEY(`tracker_connection_id`, `delivery_id`),
	CONSTRAINT `fk_tracker_events_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`),
	CONSTRAINT "tracker_events_label_ids_json" CHECK("label_ids" IS NULL OR json_valid("label_ids")),
	CONSTRAINT "tracker_events_previous_label_ids_json" CHECK("previous_label_ids" IS NULL OR json_valid("previous_label_ids"))
);
--> statement-breakpoint
INSERT INTO `__new_tracker_events`(`tracker_connection_id`, `delivery_id`, `kind`, `tracker_project_id`, `ticket_key`, `label_ids`, `received_at`, `processed_at`) SELECT `tracker_connection_id`, `delivery_id`, `kind`, `tracker_project_id`, `ticket_key`, `label_ids`, `received_at`, `processed_at` FROM `tracker_events`;--> statement-breakpoint
DROP TABLE `tracker_events`;--> statement-breakpoint
ALTER TABLE `__new_tracker_events` RENAME TO `tracker_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_one_active_per_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`) WHERE "runs"."state" <> 'ended';--> statement-breakpoint
CREATE INDEX `runs_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_state` ON `runs` (`state`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_workspace` ON `runs` (`workspace_id`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `tracker_events_unprocessed` ON `tracker_events` (`received_at`) WHERE "tracker_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `run_questions_unsent` ON `run_questions` (`answered_at`) WHERE "run_questions"."answer" IS NOT NULL AND "run_questions"."answer_sent_at" IS NULL;