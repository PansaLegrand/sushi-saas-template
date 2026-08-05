"use client";

import { useMemo, useState } from "react";

type ToolProps = {
  toolKey: string;
  config?: {
    inputLabel?: string | null;
    buttonLabel?: string | null;
    defaultKeyword?: string | null;
  };
};

export function ToolPreview({ toolKey, config }: ToolProps) {
  const [text, setText] = useState("");
  const [keyword, setKeyword] = useState(config?.defaultKeyword ?? "");
  const [part, setPart] = useState("25");
  const [whole, setWhole] = useState("100");
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text]);

  if (toolKey === "percentage-calculator") {
    const result = Number(whole) === 0 ? null : (Number(part) / Number(whole)) * 100;
    return (
      <div className="preview-tool__body preview-tool__calculator">
        <label>Part<input type="number" value={part} onChange={(event) => setPart(event.target.value)} /></label>
        <label>Whole<input type="number" value={whole} onChange={(event) => setWhole(event.target.value)} /></label>
        <output>{result === null || Number.isNaN(result) ? "—" : `${result.toFixed(2)}%`}</output>
      </div>
    );
  }

  const occurrences = keyword
    ? words.filter((word) => word.toLowerCase().replace(/[^a-z0-9-]/g, "") === keyword.toLowerCase()).length
    : 0;
  const density = words.length > 0 ? (occurrences / words.length) * 100 : 0;

  return (
    <div className="preview-tool__body">
      {toolKey === "keyword-density" ? (
        <label>
          Keyword
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        </label>
      ) : null}
      <label>
        {config?.inputLabel ?? "Text"}
        <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="preview-tool__results">
        <span><strong>{words.length}</strong> words</span>
        <span><strong>{text.length}</strong> characters</span>
        {toolKey === "keyword-density" ? <span><strong>{density.toFixed(2)}%</strong> density</span> : null}
      </div>
    </div>
  );
}
