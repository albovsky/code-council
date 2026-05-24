import type { ReactNode } from "react";

/**
 * Lightweight renderer for reviewer Markdown. It intentionally supports only
 * the syntax Code Council asks reviewers to emit: headings, fenced code,
 * tables, bullets, numbered lists, bold, inline code, and the trailing
 * `## DONE` sentinel. Keeping this local avoids adding a Markdown dependency
 * for a controlled internal output format.
 */
export function MarkdownReview({ content }: { content: string }) {
  const normalized = stripDoneSentinel(content);
  if (!normalized.trim()) {
    return <div className="text-sm text-muted-foreground">No result content.</div>;
  }

  return (
    <div className="space-y-4 text-sm leading-7 text-foreground/90">
      {renderMarkdownBlocks(normalized)}
    </div>
  );
}

export function stripDoneSentinel(content: string): string {
  return content.replace(/\n?##\s*DONE\s*$/i, "").trimEnd();
}

function renderMarkdownBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-md border border-border bg-background/70 p-3 font-mono text-xs leading-6 text-foreground/85"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (isMarkdownTable(lines, i)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        tableLines.push(lines[i]);
        i += 1;
      }
      blocks.push(renderMarkdownTable(tableLines, `table-${i}`));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const className =
        level === 1
          ? "text-2xl font-semibold leading-tight text-foreground"
          : level === 2
            ? "text-lg font-semibold leading-tight text-foreground"
            : "text-base font-semibold leading-tight text-foreground";
      blocks.push(renderMarkdownHeading(level, text, `heading-${i}`, className));
      i += 1;
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*[-*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 24)}`}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numbered) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*\d+\.\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 24)}`}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !isMarkdownTable(lines, i)
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }

    blocks.push(
      <p key={`p-${i}`} className="max-w-none text-foreground/85">
        {renderInlineMarkdown(paragraph.join(" "))}
      </p>,
    );
  }

  return blocks;
}

function renderMarkdownHeading(
  level: number,
  text: string,
  key: string,
  className: string,
): ReactNode {
  const content = renderInlineMarkdown(text);
  if (level === 1) {
    return <h1 key={key} className={className}>{content}</h1>;
  }
  if (level === 2) {
    return <h2 key={key} className={className}>{content}</h2>;
  }
  if (level === 3) {
    return <h3 key={key} className={className}>{content}</h3>;
  }
  return <h4 key={key} className={className}>{content}</h4>;
}

function isMarkdownTable(lines: string[], index: number): boolean {
  const current = lines[index]?.trim();
  const next = lines[index + 1]?.trim();
  return Boolean(
    current?.includes("|") &&
      next &&
      /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next),
  );
}

function renderMarkdownTable(lines: string[], key: string): ReactNode {
  const [headerLine, , ...bodyLines] = lines;
  const headers = splitMarkdownTableRow(headerLine);
  const rows = bodyLines.map(splitMarkdownTableRow);

  return (
    <div key={key} className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th key={`${index}-${header}`} className="border-b border-border px-3 py-2 font-medium">
                {renderInlineMarkdown(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/60 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-foreground/85">
                  {renderInlineMarkdown(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function splitMarkdownTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${index}-${part.slice(0, 16)}`}
          className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[0.92em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${index}-${part.slice(0, 16)}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
