PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`created_by_user_id` text,
	`suspended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_organizations__status" CHECK("__new_organizations"."status" IN ('active', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_organizations`("id", "name", "status", "created_by_user_id", "suspended_at", "created_at", "updated_at") SELECT "id", "name", "status", "created_by_user_id", "suspended_at", "created_at", "updated_at" FROM `organizations`;--> statement-breakpoint
DROP TABLE `organizations`;--> statement-breakpoint
ALTER TABLE `__new_organizations` RENAME TO `organizations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;