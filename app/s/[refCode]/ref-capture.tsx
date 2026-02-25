"use client";

import { useEffect } from "react";

const LS_REFERRED_BY = "viora_referred_by";

const sanitizeReferredBy = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return null;
  }
  return trimmed;
};

type Props = {
  refCode: string;
};

export default function RefCapture({ refCode }: Props) {
  useEffect(() => {
    const clean = sanitizeReferredBy(refCode);
    if (!clean) return;
    localStorage.setItem(LS_REFERRED_BY, clean);
  }, [refCode]);

  return null;
}
