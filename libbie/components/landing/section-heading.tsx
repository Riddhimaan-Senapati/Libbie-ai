/** Section heading with an eyebrow label and editorial title. Server component;
 *  the scroll reveal (`Reveal`) is the client island that wraps it. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
      <h2 className="text-balance font-display text-4xl font-normal leading-[1.1] tracking-tight text-foreground sm:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
