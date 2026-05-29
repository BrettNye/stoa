import { it, expect } from "vitest";
import { renderNoteBody } from "./render.js";

it("turns a resolved wikilink into a clickable anchor and an unresolved one into a dead span", () => {
  const body = "# Title\n\nlink [[wikis/w/concept/known]] and [[wikis/w/concept/ghost]]";
  const html = renderNoteBody(body, undefined, new Set(["known"]));
  expect(html).toContain('<a class="wikilink" data-target="known">');
  expect(html).toContain('<span class="wikilink-dead">');
});

it("renders standard markdown: headings, lists, emphasis, and code", () => {
  const body = "# Heading\n\n- item one\n- item two\n\n**bold** and *italic*\n\n`inline code`";
  const html = renderNoteBody(body, undefined, new Set());
  expect(html).toContain("<h1>");
  expect(html).toContain("<li>");
  expect(html).toContain("<strong>");
  expect(html).toContain("<em>");
  expect(html).toContain("<code>");
});

it("rewrites all occurrences of a repeated wikilink, not just the first", () => {
  const body = "see [[wikis/w/concept/node]] and again [[wikis/w/concept/node]]";
  const html = renderNoteBody(body, undefined, new Set(["node"]));
  // Count anchors — both occurrences should be replaced
  const matches = [...html.matchAll(/<a class="wikilink" data-target="node">/g)];
  expect(matches.length).toBe(2);
});

it("uses the alias as the anchor text when present", () => {
  const body = "see [[wikis/w/concept/known|My Label]]";
  const html = renderNoteBody(body, undefined, new Set(["known"]));
  expect(html).toContain('<a class="wikilink" data-target="known">My Label</a>');
});

it("does not inject raw HTML from the markdown body (html: false)", () => {
  const body = "<script>alert(1)</script>";
  const html = renderNoteBody(body, undefined, new Set());
  expect(html).not.toContain("<script>");
});

it("escapes a script tag in a wikilink alias to prevent XSS", () => {
  const body = '[[wikis/w/concept/known|</a><script>alert(1)</script>]]';
  const html = renderNoteBody(body, undefined, new Set(["known"]));
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

it("escapes a double-quote in a targetId to prevent attribute injection", () => {
  const body = '[[wikis/w/concept/a"b]]';
  const html = renderNoteBody(body, undefined, new Set(['a"b']));
  expect(html).not.toContain('data-target="a"b"');
  expect(html).toContain("&quot;");
});
