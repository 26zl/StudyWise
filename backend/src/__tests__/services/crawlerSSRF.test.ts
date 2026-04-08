/**
 * Tester for services/crawler.ts — SSRF-vern.
 *
 * Dette er den eneste forsvarslinjen mot SSRF i live-URL-fetcheren og KB-crawleren.
 * Vi tester:
 *   - URL-format-validering (protocol, hostname normalisering)
 *   - IPv4-blokkering (loopback, private, link-local, CGNAT)
 *   - IPv6-blokkering (loopback, ULA, link-local, AWS metadata)
 *   - IPv4-mapped IPv6 bypass (`::ffff:127.0.0.1`)
 *   - Redirect URL parsing
 *   - Hex-form av IPv4-mapped IPv6 (`::ffff:7f00:1`)
 *   - Tomme/ugyldige inputs
 *
 * Pinned-DNS og fetch-flyten er IKKE testet her — det krever mocking av Node http-modulen
 * og er bedre dekt av integrasjonstester.
 */
import { describe, it, expect } from "vitest";
import {
  isSafeExternalUrlFormat,
  isBlockedIpv4Address,
  isBlockedIpv6Address,
  isBlockedIpAddress,
  normalizeHostname,
  expandIpv6,
  resolveRedirectUrl,
} from "../../services/crawler.js";

describe("normalizeHostname", () => {
  it("lowercaser og trimmer hostname", () => {
    expect(normalizeHostname("EXAMPLE.COM")).toBe("example.com");
    expect(normalizeHostname("  example.com  ")).toBe("example.com");
  });

  it("fjerner brackets fra IPv6", () => {
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname("[2001:db8::1]")).toBe("2001:db8::1");
  });
});

describe("isSafeExternalUrlFormat", () => {
  // ── Protocol ──
  it("avviser URL-er uten protocol", () => {
    expect(isSafeExternalUrlFormat("example.com")).toBe(false);
  });

  it("avviser file://-URL-er", () => {
    expect(isSafeExternalUrlFormat("file:///etc/passwd")).toBe(false);
  });

  it("avviser javascript:-URL-er", () => {
    expect(isSafeExternalUrlFormat("javascript:alert(1)")).toBe(false);
  });

  it("avviser ftp://-URL-er", () => {
    expect(isSafeExternalUrlFormat("ftp://example.com/")).toBe(false);
  });

  it("aksepterer http://", () => {
    expect(isSafeExternalUrlFormat("http://example.com/")).toBe(true);
  });

  it("aksepterer https://", () => {
    expect(isSafeExternalUrlFormat("https://example.com/")).toBe(true);
  });

  // ── Localhost-blokkering ──
  it("avviser localhost", () => {
    expect(isSafeExternalUrlFormat("http://localhost/")).toBe(false);
    expect(isSafeExternalUrlFormat("http://localhost:8080/")).toBe(false);
    expect(isSafeExternalUrlFormat("https://LOCALHOST/")).toBe(false);
  });

  it("avviser .localhost-subdomener", () => {
    expect(isSafeExternalUrlFormat("http://app.localhost/")).toBe(false);
  });

  it("avviser .local-subdomener (mDNS)", () => {
    expect(isSafeExternalUrlFormat("http://mac.local/")).toBe(false);
  });

  // ── IPv4 i URL ──
  it("avviser 127.0.0.1 i URL", () => {
    expect(isSafeExternalUrlFormat("http://127.0.0.1/")).toBe(false);
  });

  it("avviser private 10.x i URL", () => {
    expect(isSafeExternalUrlFormat("http://10.0.0.1/")).toBe(false);
  });

  it("avviser link-local 169.254.x i URL", () => {
    expect(isSafeExternalUrlFormat("http://169.254.169.254/")).toBe(false);
  });

  it("aksepterer offentlig IP", () => {
    expect(isSafeExternalUrlFormat("http://8.8.8.8/")).toBe(true);
  });

  // ── IPv6 i URL ──
  it("avviser IPv6 loopback ::1", () => {
    expect(isSafeExternalUrlFormat("http://[::1]/")).toBe(false);
  });

  it("avviser IPv4-mapped IPv6 i URL", () => {
    expect(isSafeExternalUrlFormat("http://[::ffff:127.0.0.1]/")).toBe(false);
  });

  it("avviser malformerte URL-er", () => {
    expect(isSafeExternalUrlFormat("http://")).toBe(false);
    expect(isSafeExternalUrlFormat("not-a-url")).toBe(false);
    expect(isSafeExternalUrlFormat("")).toBe(false);
  });
});

describe("isBlockedIpv4Address", () => {
  it("blokkerer 0.0.0.0/8", () => {
    expect(isBlockedIpv4Address("0.0.0.0")).toBe(true);
    expect(isBlockedIpv4Address("0.1.2.3")).toBe(true);
  });

  it("blokkerer loopback 127.0.0.0/8", () => {
    expect(isBlockedIpv4Address("127.0.0.1")).toBe(true);
    expect(isBlockedIpv4Address("127.255.255.255")).toBe(true);
  });

  it("blokkerer private 10.0.0.0/8", () => {
    expect(isBlockedIpv4Address("10.0.0.0")).toBe(true);
    expect(isBlockedIpv4Address("10.255.255.255")).toBe(true);
  });

  it("blokkerer private 172.16.0.0/12", () => {
    expect(isBlockedIpv4Address("172.16.0.0")).toBe(true);
    expect(isBlockedIpv4Address("172.20.0.1")).toBe(true);
    expect(isBlockedIpv4Address("172.31.255.255")).toBe(true);
    // Edge: 172.15 og 172.32 er IKKE blokkert
    expect(isBlockedIpv4Address("172.15.0.0")).toBe(false);
    expect(isBlockedIpv4Address("172.32.0.0")).toBe(false);
  });

  it("blokkerer private 192.168.0.0/16", () => {
    expect(isBlockedIpv4Address("192.168.0.1")).toBe(true);
    expect(isBlockedIpv4Address("192.168.255.255")).toBe(true);
  });

  it("blokkerer link-local 169.254.0.0/16 (inkl. AWS metadata)", () => {
    expect(isBlockedIpv4Address("169.254.0.1")).toBe(true);
    expect(isBlockedIpv4Address("169.254.169.254")).toBe(true); // AWS metadata
  });

  it("blokkerer CGNAT 100.64.0.0/10", () => {
    expect(isBlockedIpv4Address("100.64.0.0")).toBe(true);
    expect(isBlockedIpv4Address("100.127.255.255")).toBe(true);
    // Edge: 100.63 og 100.128 er IKKE blokkert
    expect(isBlockedIpv4Address("100.63.255.255")).toBe(false);
    expect(isBlockedIpv4Address("100.128.0.0")).toBe(false);
  });

  it("aksepterer offentlige IP-adresser", () => {
    expect(isBlockedIpv4Address("8.8.8.8")).toBe(false);
    expect(isBlockedIpv4Address("1.1.1.1")).toBe(false);
    expect(isBlockedIpv4Address("142.250.74.46")).toBe(false); // google.com
  });

  it("avviser ugyldige IP-adresser", () => {
    expect(isBlockedIpv4Address("999.999.999.999")).toBe(true);
    expect(isBlockedIpv4Address("not.an.ip.address")).toBe(true);
    expect(isBlockedIpv4Address("1.2.3")).toBe(true);
    expect(isBlockedIpv4Address("")).toBe(true);
  });
});

describe("expandIpv6", () => {
  it("ekspanderer ::1 til full form", () => {
    expect(expandIpv6("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  it("ekspanderer :: til full form", () => {
    expect(expandIpv6("::")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });

  it("ekspanderer fe80:: til full form", () => {
    expect(expandIpv6("fe80::1")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
  });

  it("ekspanderer 2001:db8::1", () => {
    expect(expandIpv6("2001:db8::1")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });

  it("normaliserer hex til lowercase", () => {
    expect(expandIpv6("FE80::1")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
  });

  it("fjerner brackets", () => {
    expect(expandIpv6("[::1]")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });
});

describe("isBlockedIpv6Address", () => {
  it("blokkerer loopback ::1", () => {
    expect(isBlockedIpv6Address("::1")).toBe(true);
  });

  it("blokkerer unspecified ::", () => {
    expect(isBlockedIpv6Address("::")).toBe(true);
  });

  it("blokkerer ULA fc00::/7", () => {
    expect(isBlockedIpv6Address("fc00::1")).toBe(true);
    expect(isBlockedIpv6Address("fd12:3456:789a::1")).toBe(true);
    expect(isBlockedIpv6Address("fdff::ffff")).toBe(true);
  });

  it("blokkerer link-local fe80::/10", () => {
    expect(isBlockedIpv6Address("fe80::1")).toBe(true);
    expect(isBlockedIpv6Address("febf::1")).toBe(true);
  });

  // ── IPv4-mapped IPv6 bypass (klassisk SSRF-trick) ──
  it("blokkerer IPv4-mapped IPv6 dotted-form (::ffff:127.0.0.1)", () => {
    expect(isBlockedIpv6Address("::ffff:127.0.0.1")).toBe(true);
  });

  it("blokkerer IPv4-mapped IPv6 dotted-form med oppercase", () => {
    expect(isBlockedIpv6Address("::FFFF:127.0.0.1")).toBe(true);
  });

  it("blokkerer IPv4-mapped private IP", () => {
    expect(isBlockedIpv6Address("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedIpv6Address("::ffff:10.0.0.1")).toBe(true);
  });

  it("blokkerer IPv4-mapped IPv6 hex-form (::ffff:7f00:1 = 127.0.0.1)", () => {
    // 7f00:0001 = 127.0.0.1 i hex
    expect(isBlockedIpv6Address("::ffff:7f00:1")).toBe(true);
  });

  it("blokkerer IPv4-mapped IPv6 hex-form for private IP", () => {
    // c0a8:0101 = 192.168.1.1
    expect(isBlockedIpv6Address("::ffff:c0a8:101")).toBe(true);
  });

  it("blokkerer AWS metadata IPv6 variant", () => {
    expect(isBlockedIpv6Address("fd00:ec2::254")).toBe(true);
  });

  it("aksepterer offentlige IPv6-adresser", () => {
    expect(isBlockedIpv6Address("2001:4860:4860::8888")).toBe(false); // Google DNS
    expect(isBlockedIpv6Address("2606:4700:4700::1111")).toBe(false); // Cloudflare
  });
});

describe("isBlockedIpAddress (dispatcher)", () => {
  it("ruter IPv4 til ipv4-sjekken", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
  });

  it("ruter IPv6 til ipv6-sjekken", () => {
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("avviser ikke-IP-strenger", () => {
    expect(isBlockedIpAddress("example.com")).toBe(true);
    expect(isBlockedIpAddress("")).toBe(true);
  });
});

describe("resolveRedirectUrl", () => {
  it("løser absolutt redirect", () => {
    expect(resolveRedirectUrl("https://example.com/a", "https://other.com/b")).toBe(
      "https://other.com/b",
    );
  });

  it("løser relativ redirect mot base", () => {
    expect(resolveRedirectUrl("https://example.com/a/b", "/c")).toBe(
      "https://example.com/c",
    );
    expect(resolveRedirectUrl("https://example.com/a/b", "c")).toBe(
      "https://example.com/a/c",
    );
  });

  it("returnerer null for ugyldig location", () => {
    expect(resolveRedirectUrl("https://example.com/", "")).toBe("https://example.com/");
    // Ren garbage som verken er absolutt eller relativ
    expect(resolveRedirectUrl("not-a-url", "/path")).toBeNull();
  });

  it("aksepterer redirect til samme origin", () => {
    expect(
      resolveRedirectUrl("https://example.com/old", "https://example.com/new"),
    ).toBe("https://example.com/new");
  });

  it("redirect til localhost (dette skal IKKE blokkeres her — kalleren må re-validere)", () => {
    // resolveRedirectUrl bare PARSER URL-en — det er fetchWithSafeRedirects sin jobb å re-validere
    expect(
      resolveRedirectUrl("https://example.com/a", "http://127.0.0.1/admin"),
    ).toBe("http://127.0.0.1/admin");
    // Dette er forventet — fetchWithSafeRedirects kaller isSafeExternalUrlFormat på neste hop
  });
});
