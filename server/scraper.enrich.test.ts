import { describe, expect, it } from "vitest";
import {
  namesLikelyMatch,
  normalizeNameForMatch,
  parseContactFromHtml,
  discoverEnrichUrlsFromPage,
} from "./scraper";

describe("namesLikelyMatch", () => {
  it("matches same normalized name", () => {
    expect(namesLikelyMatch("JA Properties", "JA Properties")).toBe(true);
  });

  it("matches when one name contains the other", () => {
    expect(namesLikelyMatch("JA Properties", "JA Properties, LLC")).toBe(true);
  });

  it("does not match unrelated short strings", () => {
    expect(namesLikelyMatch("AB", "XY")).toBe(false);
  });
});

describe("normalizeNameForMatch", () => {
  it("strips punctuation", () => {
    expect(normalizeNameForMatch("Foo-Bar, LLC")).toBe("foobarllc");
  });
});

describe("discoverEnrichUrlsFromPage", () => {
  it("collects same-origin keyword links", () => {
    const html = `<html><body>
      <a href="https://other.com/team">bad</a>
      <a href="/contact-us">c</a>
      <a href="leadership.html">Leadership</a>
    </body></html>`;
    const urls = discoverEnrichUrlsFromPage(html, "https://pmco.example/about", 10);
    expect(urls.some(u => u.includes("pmco.example") && u.includes("contact"))).toBe(true);
    expect(urls.some(u => u.includes("leadership"))).toBe(true);
    expect(urls.some(u => u.includes("other.com"))).toBe(false);
  });
});

describe("parseContactFromHtml", () => {
  it("reads JSON-LD Organization email and telephone", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Organization","email":"leasing@example.com","telephone":"+1 202-555-0199"}
      </script>
    </head><body></body></html>`;
    const r = parseContactFromHtml(html);
    expect(r.email).toBe("leasing@example.com");
    expect(r.phone).toContain("202");
  });

  it("prefers scored contact emails over noreply", () => {
    const html = `<html><body>
      <a href="mailto:noreply@spam.com">x</a>
      <a href="mailto:contact@pmcompany.com">y</a>
    </body></html>`;
    const r = parseContactFromHtml(html);
    expect(r.email).toBe("contact@pmcompany.com");
  });

  it("extracts LinkedIn profile from anchors and JSON-LD sameAs", () => {
    const htmlAnchor = `<html><body>
      <a href="https://www.linkedin.com/in/jane-doe?trk=foo">Jane</a>
    </body></html>`;
    expect(parseContactFromHtml(htmlAnchor).linkedinUrl).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );

    const htmlLd = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Person","name":"Bob","sameAs":"https://linkedin.com/in/bob-smith"}
      </script>
    </head><body></body></html>`;
    expect(parseContactFromHtml(htmlLd).linkedinUrl).toBe("https://www.linkedin.com/in/bob-smith");
  });
});
