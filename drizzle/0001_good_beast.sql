CREATE TABLE `commercial_properties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scrapingJobId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` varchar(255) NOT NULL,
	`city` varchar(100),
	`state` varchar(2),
	`zipCode` varchar(10),
	`propertyType` varchar(100),
	`source` varchar(50) NOT NULL,
	`sourceUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commercial_properties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `property_managers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`propertyId` int NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`phone` varchar(20),
	`company` varchar(255),
	`title` varchar(100),
	`website` varchar(255),
	`source` varchar(50) NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `property_managers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scraping_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`zipCode` varchar(10) NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`totalProperties` int DEFAULT 0,
	`totalManagers` int DEFAULT 0,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scraping_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `commercial_properties` ADD CONSTRAINT `commercial_properties_scrapingJobId_scraping_jobs_id_fk` FOREIGN KEY (`scrapingJobId`) REFERENCES `scraping_jobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `property_managers` ADD CONSTRAINT `property_managers_propertyId_commercial_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `commercial_properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scraping_jobs` ADD CONSTRAINT `scraping_jobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;