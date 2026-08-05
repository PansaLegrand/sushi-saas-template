import type { MarketingBlock, MarketingMessage } from "./contracts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function lineBreaks(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function renderBlock(block: MarketingBlock, accentColor: string): string {
  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 32 : block.level === 2 ? 25 : 20;
      return `<h${block.level} style="margin:0 0 18px;color:#15201d;font-family:Arial,sans-serif;font-size:${size}px;line-height:1.25;text-align:${block.align};">${escapeHtml(block.text)}</h${block.level}>`;
    }
    case "text":
      return `<p style="margin:0 0 20px;color:#43504c;font-family:Arial,sans-serif;font-size:16px;line-height:1.65;text-align:${block.align};">${lineBreaks(block.text)}</p>`;
    case "image": {
      const image = `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px;" />`;
      return `<div style="margin:0 0 24px;">${block.linkUrl ? `<a href="${escapeHtml(block.linkUrl)}">${image}</a>` : image}</div>`;
    }
    case "button":
      return `<div style="margin:4px 0 24px;text-align:${block.align};"><a href="${escapeHtml(block.url)}" style="display:inline-block;padding:13px 22px;border-radius:9px;background:${accentColor};color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(block.label)}</a></div>`;
    case "divider":
      return '<div style="height:1px;margin:28px 0;background:#e4e8e6;line-height:1px;">&nbsp;</div>';
    case "spacer": {
      const height = block.size === "small" ? 12 : block.size === "large" ? 40 : 24;
      return `<div style="height:${height}px;line-height:${height}px;">&nbsp;</div>`;
    }
  }
}

function blockText(block: MarketingBlock): string {
  switch (block.type) {
    case "heading":
    case "text":
      return block.text;
    case "image":
      return block.alt ? `[Image: ${block.alt}]` : "";
    case "button":
      return `${block.label}: ${block.url}`;
    case "divider":
      return "---";
    case "spacer":
      return "";
  }
}

export function renderMarketingMessage(
  message: MarketingMessage,
  unsubscribeUrl: string,
): { html: string; text: string } {
  const { template } = message;
  const blocks = message.blocks
    .map((block) => renderBlock(block, template.accentColor))
    .join("");
  const preheader = message.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(message.preheader)}</div>`
    : "";
  const logo = template.logoUrl
    ? `<div style="margin:0 0 26px;"><img src="${escapeHtml(template.logoUrl)}" alt="" style="display:block;max-width:180px;max-height:52px;border:0;" /></div>`
    : "";

  const html = `<!doctype html><html lang="${message.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:${template.pageBackgroundColor};"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${template.pageBackgroundColor};"><tr><td align="center" style="padding:32px 14px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:${template.contentBackgroundColor};border-radius:16px;"><tr><td style="padding:42px 40px 34px;">${preheader}${logo}${blocks}</td></tr><tr><td style="padding:24px 40px 34px;border-top:1px solid #e4e8e6;color:#68736f;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">${template.footerText ? `<div style="margin-bottom:8px;">${lineBreaks(template.footerText)}</div>` : ""}<div>${lineBreaks(template.companyAddress)}</div><div style="margin-top:8px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#52635e;text-decoration:underline;">Unsubscribe</a></div></td></tr></table></td></tr></table></body></html>`;

  const text = [
    ...message.blocks.map(blockText),
    template.footerText,
    template.companyAddress,
    `Unsubscribe: ${unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}
