CREATE TABLE `ingestion_fetch_retries` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_notice_id` text NOT NULL,
	`xml_url` text NOT NULL,
	`publication_date` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_ingestion_fetch_retries__status" CHECK("ingestion_fetch_retries"."status" IN ('pending', 'recovered', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ingestion_fetch_retries__source_source_notice_id` ON `ingestion_fetch_retries` (`source`,`source_notice_id`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_fetch_retries__pending_next_attempt_at` ON `ingestion_fetch_retries` (`next_attempt_at`,`id`) WHERE "ingestion_fetch_retries"."status" = 'pending';--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `notices_fetch_failed` integer DEFAULT 0 NOT NULL;