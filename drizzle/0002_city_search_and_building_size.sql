ALTER TABLE `scraping_jobs` MODIFY COLUMN `zipCode` varchar(120) NOT NULL;
--> statement-breakpoint
ALTER TABLE `commercial_properties` ADD COLUMN `buildingSizeSqft` int;
--> statement-breakpoint
ALTER TABLE `commercial_properties` ADD COLUMN `buildingLevels` int;
