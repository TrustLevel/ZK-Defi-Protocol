"use client";

import { useId, useState } from "react";
import { GLOSSARY } from "../lib/glossary";

// A word with its explanation: on hover, on keyboard focus and on tap.
export default function Term({ id, children }) {
  const [open, setOpen] = useState(false);
  const tip = useId();
  const entry = GLOSSARY[id];
  if (!entry) return children;
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-describedby={open ? tip : undefined}
        className="cursor-help underline decoration-dotted underline-offset-2 [letter-spacing:inherit] [text-transform:inherit]"
        onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        {children ?? entry.term}
      </button>
      {open && (
        <span id={tip} role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 block w-72 max-w-[80vw] rounded-md border border-line bg-surface p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-lg">
          {entry.text}
        </span>
      )}
    </span>
  );
}
