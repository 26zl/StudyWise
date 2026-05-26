/*
 * Tester for stripHtml-funksjonen
 * Verifiserer korrekt stripping av HTML-tagger og dekoding av entiteter
 */

import { describe, it, expect } from "vitest";
import { stripHtml } from "../../utils/htmlUtils.js";

describe("stripHtml", () => {
  // --- Grunnleggende tag-fjerning ---

  it("fjerner enkle HTML-tagger", () => {
    expect(stripHtml("<p>tekst</p>")).toBe("tekst");
  });

  it("fjerner nøstede tagger", () => {
    expect(stripHtml("<div><p><strong>nøstet</strong></p></div>")).toBe("nøstet");
  });

  it("fjerner selvlukkende tagger", () => {
    expect(stripHtml("før<br/>etter")).toBe("før etter");
    expect(stripHtml("før<hr />etter")).toBe("før etter");
    expect(stripHtml("før<img src='x' />etter")).toBe("før etter");
  });

  it("bevarer tekstinnhold mellom tagger", () => {
    expect(stripHtml("<li>første</li><li>andre</li><li>tredje</li>")).toBe("første andre tredje");
  });

  it("håndterer flere tagger med mellomrom korrekt", () => {
    expect(stripHtml("<p>Hei</p> <p>Verden</p>")).toBe("Hei Verden");
  });

  // --- Tomme og enkle strenger ---

  it("håndterer tom streng", () => {
    expect(stripHtml("")).toBe("");
  });

  it("returnerer ren tekst uendret", () => {
    expect(stripHtml("ingen tagger her")).toBe("ingen tagger her");
  });

  it("trimmer whitespace rundt resultatet", () => {
    expect(stripHtml("  <p> tekst </p>  ")).toBe("tekst");
  });

  // --- HTML-entiteter ---

  it("dekoder &nbsp; til mellomrom", () => {
    expect(stripHtml("ord&nbsp;ord")).toBe("ord ord");
  });

  it("dekoder &lt; og &gt;", () => {
    expect(stripHtml("&lt;kode&gt;")).toBe("<kode>");
  });

  it("dekoder &quot; og &#39;", () => {
    expect(stripHtml("&quot;sitat&quot; og &#39;apostrof&#39;")).toBe("\"sitat\" og 'apostrof'");
  });

  it("dekoder &amp; sist (unngår dobbel-dekoding)", () => {
    expect(stripHtml("&amp;")).toBe("&");
  });

  it("dekoder flere entiteter i rekkefølge", () => {
    expect(stripHtml("A &amp; B &lt; C")).toBe("A & B < C");
  });

  // --- removeStyles-alternativ ---

  it("fjerner <style>-blokker med removeStyles: true", () => {
    const html = "<style>.cls { color: red; }</style><p>synlig</p>";
    expect(stripHtml(html, { removeStyles: true })).toBe("synlig");
  });

  it("fjerner flere <style>-blokker", () => {
    const html = "<style>a{}</style><p>tekst</p><style>b{}</style>";
    expect(stripHtml(html, { removeStyles: true })).toBe("tekst");
  });

  it("fjerner nøstede <style>-blokker", () => {
    const html = "<style>outer<style>inner</style></style><p>innhold</p>";
    expect(stripHtml(html, { removeStyles: true })).toBe("innhold");
  });

  it("fjerner <link rel='stylesheet'> med removeStyles: true", () => {
    const html = '<link rel="stylesheet" href="style.css"><p>tekst</p>';
    expect(stripHtml(html, { removeStyles: true })).toBe("tekst");
  });

  it("beholder <style>-innhold som tekst uten removeStyles", () => {
    const html = "<style>.cls { color: red; }</style><p>synlig</p>";
    const result = stripHtml(html);
    // Uten removeStyles fjernes bare tagger, style-innhold blir tekst
    expect(result).toContain("synlig");
    expect(result).toContain("color");
  });

  // --- Misdannet HTML ---

  it("håndterer ulukkede tagger", () => {
    expect(stripHtml("<p>tekst")).toBe("tekst");
  });

  it("håndterer tagger uten innhold", () => {
    expect(stripHtml("<div></div>")).toBe("");
  });

  it("håndterer tilfeldig vinkelparentes i tekst", () => {
    // > uten < er ikke en tag, men < starter en "tag" som regex fjerner
    expect(stripHtml("5 > 3")).toBe("5 > 3");
  });

  // --- Whitespace-normalisering ---

  it("kollapser flere mellomrom til ett", () => {
    expect(stripHtml("<p>  mye   mellomrom  </p>")).toBe("mye mellomrom");
  });

  it("kollapser linjeskift og tabs", () => {
    expect(stripHtml("<p>linje1\n\nlinje2\t\ttab</p>")).toBe("linje1 linje2 tab");
  });
});
