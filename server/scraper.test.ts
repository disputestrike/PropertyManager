import { describe, it, expect } from "vitest";
import { normalizeZipCode, scrapePropertiesForZipCode } from "./scraper";

describe("Scraper Service", () => {
  describe("normalizeZipCode", () => {
    it("should normalize a 5-digit ZIP code", () => {
      const result = normalizeZipCode("90210");
      expect(result).toBe("90210");
    });

    it("should normalize a 9-digit ZIP code", () => {
      const result = normalizeZipCode("90210-1234");
      expect(result).toBe("90210-1234");
    });

    it("should normalize ZIP codes with spaces", () => {
      const result = normalizeZipCode("90210 1234");
      expect(result).toBe("90210-1234");
    });

    it("should return null for invalid ZIP codes", () => {
      expect(normalizeZipCode("1234")).toBeNull();
      expect(normalizeZipCode("abc12")).toBeNull();
      expect(normalizeZipCode("")).toBeNull();
    });

    it("should handle ZIP codes with dashes", () => {
      const result = normalizeZipCode("90210-1234");
      expect(result).toBe("90210-1234");
    });
  });

  describe("scrapePropertiesForZipCode", () => {
    it("should throw error for invalid ZIP code", async () => {
      await expect(scrapePropertiesForZipCode("invalid")).rejects.toThrow(
        "Invalid ZIP code format"
      );
    });

    it("should return properties for valid ZIP code", async () => {
      const properties = await scrapePropertiesForZipCode("90210");
      expect(Array.isArray(properties)).toBe(true);
      expect(properties.length).toBeGreaterThan(0);
    });

    it("should include required property fields", async () => {
      const properties = await scrapePropertiesForZipCode("90210");
      expect(properties.length).toBeGreaterThan(0);

      const property = properties[0];
      expect(property).toHaveProperty("name");
      expect(property).toHaveProperty("address");
      expect(property).toHaveProperty("city");
      expect(property).toHaveProperty("state");
      expect(property).toHaveProperty("zipCode");
      expect(property).toHaveProperty("source");
      expect(property).toHaveProperty("managers");
    });

    it("should include property managers", async () => {
      const properties = await scrapePropertiesForZipCode("90210");
      expect(properties.length).toBeGreaterThan(0);

      const property = properties[0];
      expect(Array.isArray(property.managers)).toBe(true);
      expect(property.managers.length).toBeGreaterThan(0);
    });

    it("should include manager contact information", async () => {
      const properties = await scrapePropertiesForZipCode("90210");
      expect(properties.length).toBeGreaterThan(0);

      const property = properties[0];
      const manager = property.managers[0];

      expect(manager).toHaveProperty("source");
      // At least one contact method should be present
      expect(
        manager.name || manager.email || manager.phone || manager.company
      ).toBeTruthy();
    });
  });
});
