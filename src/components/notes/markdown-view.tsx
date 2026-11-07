import { type Block, type Inline, parseMarkdown } from "./markdown";

function InlineView({ node }: { node: Inline }) {
  if (node.type === "text") return node.text;
  if (node.type === "code") {
    return <code className="break-all rounded-md bg-background px-1 font-mono text-sm">{node.text}</code>;
  }
  if (node.type === "strong") {
    return (
      <strong>
        {node.children.map((child, index) => (
          <InlineView key={index} node={child} />
        ))}
      </strong>
    );
  }
  if (node.type === "em") {
    return (
      <em>
        {node.children.map((child, index) => (
          <InlineView key={index} node={child} />
        ))}
      </em>
    );
  }
  const external = /^https?:/i.test(node.href);
  return (
    <a
      href={node.href}
      className="break-all text-accent underline underline-offset-2"
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
    >
      {node.children.map((child, index) => (
        <InlineView key={index} node={child} />
      ))}
    </a>
  );
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => <InlineView key={index} node={node} />);
}

const headingClass: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: "font-display text-2xl font-semibold",
  3: "font-display text-xl font-semibold",
  4: "text-lg font-semibold",
  5: "text-base font-semibold",
  6: "text-sm font-semibold",
};

function BlockView({ block }: { block: Block }) {
  if (block.type === "heading") {
    const level = Math.min(block.level + 1, 6) as 2 | 3 | 4 | 5 | 6;
    const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
    return (
      <Tag className={headingClass[level]}>
        <Inlines nodes={block.children} />
      </Tag>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
        {block.items.map((item, index) => (
          <li key={index} className="break-words">
            <Inlines nodes={item} />
          </li>
        ))}
      </Tag>
    );
  }
  if (block.type === "code") {
    return (
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-card bg-background p-3 font-mono text-sm">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === "quote") {
    return (
      <blockquote className="space-y-3 border-l-2 border-border pl-3 text-muted">
        {block.children.map((child, index) => (
          <BlockView key={index} block={child} />
        ))}
      </blockquote>
    );
  }
  return (
    <p className="break-words leading-relaxed">
      <Inlines nodes={block.children} />
    </p>
  );
}

/** Renders note Markdown. HTML in the source stays text, and unsafe links are not anchors. */
export function MarkdownView({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return <p className="text-muted">This note is empty.</p>;
  return (
    <div className="min-w-0 max-w-full space-y-3 break-words">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
