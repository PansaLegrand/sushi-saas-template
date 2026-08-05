import { RichText } from "@payloadcms/richtext-lexical/react";
import { ToolPreview } from "@/components/tool-preview";
import { safePublicHref } from "@/lib/public-urls";
import type { Page, Post } from "@/payload-types";

type PreviewDocument = Page | Post;
type Block = NonNullable<Page["layout"]>[number];

export function ContentPreview({ document }: { document: PreviewDocument }) {
  return (
    <article className="preview-page">
      <header className="preview-page__header">
        <span>Draft preview</span>
        <h1>{document.title}</h1>
        <p>{document.summary}</p>
      </header>
      <div className="preview-page__blocks">
        {(document.layout ?? []).map((block: Block, index: number) => {
          const key = block.id ?? `${block.blockType}-${index}`;
          if (block.blockType === "hero") {
            return <section className={`preview-hero preview-hero--${block.alignment}`} key={key}>
              {block.eyebrow ? <span>{block.eyebrow}</span> : null}<h2>{block.heading}</h2>{block.lede ? <p>{block.lede}</p> : null}
            </section>;
          }
          if (block.blockType === "richText") {
            return <section className="preview-richtext" key={key}><RichText data={block.content} /></section>;
          }
          if (block.blockType === "callout") {
            return <aside className={`preview-callout preview-callout--${block.tone}`} key={key}>{block.heading ? <h3>{block.heading}</h3> : null}<p>{block.body}</p></aside>;
          }
          if (block.blockType === "faq") {
            return <section className="preview-faq" key={key}><h2>{block.heading}</h2>{(block.items ?? []).map((item) => <details key={item.id ?? item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>;
          }
          if (block.blockType === "cta") {
            return <section className="preview-cta" key={key}><div><h2>{block.heading}</h2>{block.body ? <p>{block.body}</p> : null}</div><a href={safePublicHref(block.href) ?? "#"}>{block.label}</a></section>;
          }
          if (block.blockType === "tool") {
            return <section className={`preview-tool preview-tool--${block.theme}`} key={key}><h2>{block.heading}</h2>{block.description ? <p>{block.description}</p> : null}<ToolPreview toolKey={block.toolKey} config={block.config} /></section>;
          }
          return null;
        })}
      </div>
    </article>
  );
}
