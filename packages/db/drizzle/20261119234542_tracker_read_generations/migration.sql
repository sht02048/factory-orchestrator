CREATE TABLE `tracker_read_generations` (
	`tracker_connection_id` text PRIMARY KEY,
	`generation` integer NOT NULL,
	CONSTRAINT `fk_tracker_read_generations_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`) ON DELETE CASCADE,
	CONSTRAINT "tracker_read_generations_positive" CHECK("generation" > 0)
);
