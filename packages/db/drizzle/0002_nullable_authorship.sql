PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customer_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text,
	`verdict` text NOT NULL,
	`reasons_json` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `tender_matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_customer_feedback__verdict" CHECK("__new_customer_feedback"."verdict" IN ('useful', 'not_useful'))
);
--> statement-breakpoint
INSERT INTO `__new_customer_feedback`("id", "organization_id", "match_id", "user_id", "verdict", "reasons_json", "comment", "created_at", "updated_at") SELECT "id", "organization_id", "match_id", "user_id", "verdict", "reasons_json", "comment", "created_at", "updated_at" FROM `customer_feedback`;--> statement-breakpoint
DROP TABLE `customer_feedback`;--> statement-breakpoint
ALTER TABLE `__new_customer_feedback` RENAME TO `customer_feedback`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_feedback__organization_id_match_id` ON `customer_feedback` (`organization_id`,`match_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_feedback__organization_id_created_at` ON `customer_feedback` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_ignored_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`ignored_by_user_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `tender_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notice_id`) REFERENCES `tender_notices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ignored_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ignored_tenders`("id", "organization_id", "lot_id", "notice_id", "ignored_by_user_id", "reason", "created_at") SELECT "id", "organization_id", "lot_id", "notice_id", "ignored_by_user_id", "reason", "created_at" FROM `ignored_tenders`;--> statement-breakpoint
DROP TABLE `ignored_tenders`;--> statement-breakpoint
ALTER TABLE `__new_ignored_tenders` RENAME TO `ignored_tenders`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ignored_tenders__organization_id_lot_id` ON `ignored_tenders` (`organization_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `idx_ignored_tenders__lot_id` ON `ignored_tenders` (`lot_id`);--> statement-breakpoint
CREATE TABLE `__new_saved_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`saved_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `tender_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notice_id`) REFERENCES `tender_notices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`saved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_saved_tenders`("id", "organization_id", "lot_id", "notice_id", "saved_by_user_id", "created_at") SELECT "id", "organization_id", "lot_id", "notice_id", "saved_by_user_id", "created_at" FROM `saved_tenders`;--> statement-breakpoint
DROP TABLE `saved_tenders`;--> statement-breakpoint
ALTER TABLE `__new_saved_tenders` RENAME TO `saved_tenders`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_saved_tenders__organization_id_lot_id` ON `saved_tenders` (`organization_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `idx_saved_tenders__lot_id` ON `saved_tenders` (`lot_id`);