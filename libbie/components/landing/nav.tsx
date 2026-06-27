"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { brand } from "@/lib/data";

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Meet Libbie", href: "#meet" },
  { label: "How she answers", href: "#how" },
  { label: "Air-gapped", href: "#air-gapped" },
  { label: "Pricing", href: "#pricing" },
];

/** Thin Benchling-style announcement bar above the nav. */
function AnnouncementBar() {
  return (
    <div className="w-full bg-accent text-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-5 py-2 text-center text-xs sm:px-8 sm:text-sm">
        <span className="text-foreground/80">
          Libbie now reconstructs intent across code + conversations.
        </span>
        <Link
          href="/demo"
          className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
        >
          See how →
        </Link>
      </div>
    </div>
  );
}

/** Sticky, white Benchling-style top navigation for the landing page. */
export function LandingNav() {
  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-50 w-full border-b border-border bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
    >
      <AnnouncementBar />
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex items-center" aria-label={`${brand.name} home`}>
          <Logo className="h-7" />
        </Link>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/demo"
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "h-9 rounded-full px-5",
            )}
          >
            Sign up
          </Link>
          <Link
            href="/demo"
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-9 rounded-full px-5",
            )}
          >
            Meet Libbie
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}
