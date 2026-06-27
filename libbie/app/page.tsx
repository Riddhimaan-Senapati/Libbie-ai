import type { Metadata } from "next";

import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { MeetLibbie } from "@/components/landing/problem";
import { HowSheAnswers } from "@/components/landing/fusion";
import { AirGapped } from "@/components/landing/on-prem";
import { Pricing } from "@/components/landing/pricing";
import { CtaFooter } from "@/components/landing/cta-footer";
import { brand, libbie } from "@/lib/data";

export const metadata: Metadata = {
  title: `${brand.name} — Libbie remembers why`,
  description: `Meet Libbie, ${libbie.role}. She's read every line of code and every conversation, and answers why every pipeline was built this way — cited to both.`,
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <MeetLibbie />
        <HowSheAnswers />
        <AirGapped />
        <Pricing />
        <CtaFooter />
      </main>
    </div>
  );
}
