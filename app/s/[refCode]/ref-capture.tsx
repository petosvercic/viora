"use client";
import { useEffect } from "react";

export default function RefCapture({ refCode }: { refCode: string }) {
  useEffect(() => {
    try {
      if (refCode && refCode !== "undefined" && refCode !== "null") {
        localStorage.setItem("viora_referred_by", refCode);
      }
    } catch {}
  }, [refCode]);

  return null;
}