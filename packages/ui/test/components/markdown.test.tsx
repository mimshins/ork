/**
 * @file Tests for the Markdown view: the subset draws as its elements, a
 *   newline is a line break, and untrusted text (raw HTML, a script link, an
 *   image) never becomes an element, an attribute or a fetch: only `http:`,
 *   `https:` and `mailto:` are links, any other target shows as text with the
 *   target beside it. Code blocks name their copy buttons apart.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { firstLineOf } from "../../src/components/markdown-text.ts";
import { Markdown } from "../../src/components/markdown.tsx";
import { violations } from "../axe.ts";

afterEach(cleanup);

const draw = (text: string, startLevel: 3 | 4 = 4) =>
  render(
    <Markdown
      startLevel={startLevel}
      text={text}
    />,
  ).container;

/** Every attribute name on every element under the container. */
const attributes = (root: Element): string[] =>
  [...root.querySelectorAll("*")].flatMap(el => el.getAttributeNames());

describe("the Markdown view", () => {
  it("draws headings, lists, emphasis, code, quotes and rules", () => {
    const root = draw(
      [
        "# One",
        "## Two",
        "- a",
        "- b",
        "",
        "1. x",
        "2. y",
        "",
        "*em* **strong** `code`",
        "",
        "> quoted",
        "",
        "---",
      ].join("\n"),
    );
    expect(
      screen.getByRole("heading", { name: "One", level: 4 }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Two", level: 5 }),
    ).toBeDefined();
    expect(root.querySelectorAll("ul > li")).toHaveLength(2);
    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(root.querySelector("em")?.textContent).toBe("em");
    expect(root.querySelector("strong")?.textContent).toBe("strong");
    expect(root.querySelector("p code")?.textContent).toBe("code");
    expect(root.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(root.querySelector("hr")).not.toBeNull();
  });

  it("starts its headings where it is told, so the page's order holds", () => {
    draw("# Title", 3);
    expect(
      screen.getByRole("heading", { name: "Title", level: 3 }),
    ).toBeDefined();
  });

  it("breaks a line at a newline, as the gate text is written in lines", () => {
    const root = draw("one\ntwo\nthree");
    expect(root.querySelectorAll("br")).toHaveLength(2);
  });

  it("shows raw HTML as text, never as an element", () => {
    const root = draw(
      [
        "<script>alert(1)</script>",
        "",
        'a <img src="x" onerror="alert(1)"> b',
        "",
        '<div style="x" onclick="y">block</div>',
      ].join("\n"),
    );
    expect(root.querySelector("script, img, iframe")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.textContent).toContain('<img src="x" onerror="alert(1)">');
    expect(
      attributes(root).filter(name => /^(on|style|src)/u.test(name)),
    ).toEqual([]);
  });

  it("makes a link only of http, https and mailto, opened safely", () => {
    const root = draw(
      [
        "[web](https://example.com/a) [plain](http://example.com)",
        "[mail](mailto:a@example.com)",
        "[x](javascript:alert(1)) [y](data:text/html,hi) [z](file:///etc/passwd)",
        "[rel](decisions/ADR-068-document-field.md)",
      ].join("\n"),
    );
    const links = [...root.querySelectorAll("a")];
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "http://example.com",
      "mailto:a@example.com",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.textContent).toContain("(opens in a new tab)");
    }
    expect(root.textContent).toContain("x (javascript:alert(1))");
    expect(root.textContent).toContain(
      "rel (decisions/ADR-068-document-field.md)",
    );
    expect(root.innerHTML).not.toMatch(/href="(?!https?:|mailto:)/u);
  });

  it("shows a target once when the link's text is the target", () => {
    const root = draw("[a/b.md](a/b.md)");
    expect(root.textContent).toBe("a/b.md");
  });

  it("shows an image as its alt text and loads nothing", () => {
    const root = draw(
      "![diagram of the flow](https://example.com/x.png) ![](y.png)",
    );
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toBe("image: diagram of the flow image");
  });

  it("leaves tables as their source lines", () => {
    const root = draw("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(root.querySelector("table")).toBeNull();
    expect(root.textContent).toContain("| a | b |");
  });

  it("draws a code block with a caption and a copy button naming it", () => {
    draw("```yaml\na: 1\n```\n\n```\nb: 2\n```");
    expect(screen.getByText("yaml")).toBeDefined();
    expect(screen.getByText("a: 1")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy code block 1 of 2" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy code block 2 of 2" }),
    ).toBeDefined();
  });

  it("names a lone code block's button Copy code, and an HTML block is one", () => {
    draw("<div>hi</div>");
    expect(screen.getByText("<div>hi</div>")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeDefined();
  });

  it("shows a reference link's target, so a path never vanishes", () => {
    const root = draw("see [adr][1]\n\n[1]: decisions/ADR-068.md");
    expect(root.textContent).toContain("adr");
    expect(root.textContent).toContain("[1]: decisions/ADR-068.md");
  });

  it("shows text nested too deep as written, with a note, and names its first line", () => {
    const deep = `${">".repeat(6000)} deep question\nsecond line`;
    const root = draw(deep);
    expect(root.textContent).toContain(
      "Could not render this as Markdown: showing the text as written.",
    );
    expect(root.querySelector("pre")?.textContent).toBe(deep);
    expect(firstLineOf(deep, 20)).toBe(`${">".repeat(19)}…`);
  });

  it("has nothing for axe to find", async () => {
    const root = draw("# T\n\n- a\n- b\n\n```\nc\n```\n\n[l](https://e.com)");
    expect(await violations(root)).toEqual([]);
  });
});
