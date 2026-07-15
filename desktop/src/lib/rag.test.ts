import { describe, it, expect } from "vitest";
import { retrieve, chunkCorpus, buildMessages } from "@/lib/rag";

// These exercise the hand-tuned lexical retrieval + confidence heuristics — the
// logic the code review flagged as most likely to regress silently.

describe("retrieve (lexical)", () => {
  it("selects the reference-build code + conversation for a GRCh37 question", () => {
    const r = retrieve("Why was this pipeline built on GRCh37 instead of GRCh38?");
    // The discriminative token "grch37" should surface the params config…
    expect(r.code.some((c) => c.path === "conf/params.config")).toBe(true);
    // …and the reference-build conversation.
    expect(r.conversations.length).toBeGreaterThan(0);
    expect(r.conversations[0].title).toMatch(/reference build/i);
    expect(r.mode).toBe("lexical");
  });

  it("routes a MAPQ filter question to the hard-filtering module", () => {
    const r = retrieve("Why is the MAPQ minimum set to 30 in hard-filtering?");
    expect(r.code.some((c) => c.path === "modules/local/filter_variants.nf")).toBe(
      true,
    );
  });

  it("caps code hits at 2 and conversations at 2", () => {
    const r = retrieve("GRCh37 bwa mapq gatk depth alignment reference filter");
    expect(r.code.length).toBeLessThanOrEqual(2);
    expect(r.conversations.length).toBeLessThanOrEqual(2);
  });

  it("gives higher confidence when both code and conversation match than a miss", () => {
    const strong = retrieve("Why GRCh37 reference build for the Helix cohort?");
    const miss = retrieve("xyzzy plugh frobnicate quux");
    expect(strong.confidence).toBeGreaterThan(miss.confidence);
    expect(strong.confidence).toBeLessThanOrEqual(0.96);
    // A pure-stopword/nonsense query retrieves nothing and stays at the floor.
    expect(miss.code).toHaveLength(0);
    expect(miss.confidence).toBeCloseTo(0.4, 5);
  });

  it("filters stopwords — a query of only stopwords retrieves no code", () => {
    const r = retrieve("why was the it and or but how");
    expect(r.code).toHaveLength(0);
  });

  it("includes both evidence sections in the grounded context block", () => {
    const r = retrieve("Why GRCh37 reference build?");
    expect(r.context).toContain("=== CODE EVIDENCE ===");
    expect(r.context).toContain("=== CONVERSATION EVIDENCE ===");
  });
});

describe("chunkCorpus", () => {
  const chunks = chunkCorpus();

  it("produces both code and conversation chunks", () => {
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(kinds.has("code")).toBe(true);
    expect(kinds.has("conversation")).toBe(true);
  });

  it("carries citation metadata: code chunks have a path + 1-based line", () => {
    const code = chunks.filter((c) => c.kind === "code");
    expect(code.length).toBeGreaterThan(0);
    for (const c of code) {
      expect(c.path).toBeTruthy();
      expect(c.line_start).toBeGreaterThanOrEqual(1);
      expect(c.conv_id).toBeNull();
    }
  });

  it("conversation chunks carry a conv_id and no path", () => {
    const convs = chunks.filter((c) => c.kind === "conversation");
    expect(convs.length).toBeGreaterThan(0);
    for (const c of convs) {
      expect(c.conv_id).toBeTruthy();
      expect(c.path).toBeNull();
    }
  });
});

describe("buildMessages", () => {
  const retrieved = retrieve("Why GRCh37?");

  it("emits a system prompt then the grounded user turn", () => {
    const msgs = buildMessages("Why GRCh37?", retrieved, "technical");
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("Why GRCh37?");
  });

  it("swaps the closing instruction per audience without re-retrieving", () => {
    const tech = buildMessages("Q", retrieved, "technical")[1].content;
    const exec = buildMessages("Q", retrieved, "executive")[1].content;
    expect(tech).not.toEqual(exec);
    expect(exec.toLowerCase()).toContain("executive");
  });
});
