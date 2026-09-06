"use client";

import { LazyMotion, domAnimation } from "motion/react";

/**
 * Loads only the domAnimation feature set for every `m` component on the site
 * (roughly half of the full motion bundle). `strict` throws if anything
 * imports the full `motion` components, so the smaller set can't regress.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <LazyMotion features={domAnimation} strict>{children}</LazyMotion>;
}
