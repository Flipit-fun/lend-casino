"use client";

import { useEffect, useRef } from "react";
import { MARKUP } from "./markup";
import { initCage } from "./casino";
import AppBridge from "./AppBridge";

export default function TheCage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset to the pristine markup so re-runs (e.g. React StrictMode) start
    // from clean containers before the logic populates them again.
    if (ref.current) ref.current.innerHTML = MARKUP;
    const cleanup = initCage();
    return () => cleanup();
  }, []);

  return (
    <>
      <div ref={ref} dangerouslySetInnerHTML={{ __html: MARKUP }} />
      <AppBridge />
    </>
  );
}
