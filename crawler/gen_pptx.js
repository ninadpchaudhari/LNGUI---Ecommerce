const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "DM vs NL Crawler";
pres.title = "DM vs NL Reachability Analysis";

// ── Colors ──
const BG = "0F1117";
const BG2 = "161822";
const DM = "58A6FF";
const NL = "F78166";
const GREEN = "7EE787";
const GOLD = "FFD700";
const RED = "F85149";
const WHITE = "FFFFFF";
const GRAY = "888888";
const LGRAY = "CCCCCC";
const CARD = "1A1D2E";
const BORDER = "2A2D3E";

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ════════════════════════════════════════════════════════════════════════════
const s1 = pres.addSlide();
s1.background = { color: BG };

// Top accent line
s1.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.04, fill: { color: DM } });

s1.addText("DM vs NL Reachability Analysis", {
  x: 0.8, y: 1.4, w: 8.4, h: 1.2,
  fontSize: 36, fontFace: "Arial Black", color: WHITE, bold: true, align: "left", margin: 0,
});

s1.addText("Comparing CrawlJax-style State Exploration\nwith NL-Mediated GUI Testing", {
  x: 0.8, y: 2.7, w: 8.4, h: 0.9,
  fontSize: 18, fontFace: "Calibri", color: LGRAY, align: "left", margin: 0,
});

// Accent dots
s1.addShape(pres.shapes.OVAL, { x: 0.8, y: 4.0, w: 0.18, h: 0.18, fill: { color: DM } });
s1.addText("Direct Manipulation", { x: 1.1, y: 3.93, w: 2, h: 0.3, fontSize: 11, color: DM, fontFace: "Calibri", margin: 0 });
s1.addShape(pres.shapes.OVAL, { x: 3.3, y: 4.0, w: 0.18, h: 0.18, fill: { color: NL } });
s1.addText("Natural Language", { x: 3.6, y: 3.93, w: 2, h: 0.3, fontSize: 11, color: NL, fontFace: "Calibri", margin: 0 });
s1.addShape(pres.shapes.OVAL, { x: 5.6, y: 4.0, w: 0.18, h: 0.18, fill: { color: GREEN } });
s1.addText("Shared States", { x: 5.9, y: 3.93, w: 2, h: 0.3, fontSize: 11, color: GREEN, fontFace: "Calibri", margin: 0 });

// Bottom bar
s1.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.1, w: 10, h: 0.525, fill: { color: CARD } });
s1.addText("Chat-Assisted Ecommerce Case Study  ·  April 2026", {
  x: 0.8, y: 5.15, w: 8.4, h: 0.45, fontSize: 12, color: GRAY, fontFace: "Calibri", align: "left", margin: 0,
});

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — How It Works
// ════════════════════════════════════════════════════════════════════════════
const s2 = pres.addSlide();
s2.background = { color: BG };

s2.addText("How It Works: State-Event Flow Graphs", {
  x: 0.5, y: 0.3, w: 9, h: 0.6,
  fontSize: 24, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0,
});

// DM card (left)
s2.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.1, w: 4.4, h: 3.4, fill: { color: CARD }, line: { color: BORDER, width: 1 } });
s2.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.1, w: 4.4, h: 0.04, fill: { color: DM } });

s2.addText("Direct Manipulation (DM)", {
  x: 0.6, y: 1.2, w: 4, h: 0.35, fontSize: 14, fontFace: "Calibri", color: DM, bold: true, margin: 0,
});
s2.addText([
  { text: "CrawlJax-style BFS exploration", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Systematically tries every control value", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Depth 0: Baseline (1 state)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Depth 1: Single control changes (~17 states)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Depth 2: Compound combinations (~129 states)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Theoretical max: 6×4×5×2×5 = 1,200", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "State = O(σ) = {V: controls, D: products}", options: { bullet: true, fontSize: 10, color: GRAY } },
], { x: 0.6, y: 1.65, w: 4, h: 2.7, color: LGRAY, fontFace: "Calibri", paraSpaceAfter: 4, valign: "top", margin: 0 });

// NL card (right)
s2.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.1, w: 4.4, h: 3.4, fill: { color: CARD }, line: { color: BORDER, width: 1 } });
s2.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.1, w: 4.4, h: 0.04, fill: { color: NL } });

s2.addText("Natural Language (NL)", {
  x: 5.4, y: 1.2, w: 4, h: 0.35, fontSize: 14, fontFace: "Calibri", color: NL, bold: true, margin: 0,
});
s2.addText([
  { text: "Sends utterances to chat assistant", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Phase 1: Single-shot (reset between each)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "Phase 2: Refinement chains (no reset)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: '"show electronics" → "under $100" → "sort"', options: { bullet: true, breakLine: true, fontSize: 10, italic: true } },
  { text: "Tests: multi-step = single compositional?", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "fp(u,σ) = controls changed by utterance", options: { bullet: true, fontSize: 10, color: GRAY } },
], { x: 5.4, y: 1.65, w: 4, h: 2.7, color: LGRAY, fontFace: "Calibri", paraSpaceAfter: 4, valign: "top", margin: 0 });

// Bottom insight
s2.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 4.7, w: 9.2, h: 0.7, fill: { color: "1E2030" }, line: { color: BORDER, width: 1 } });
s2.addText("Key: DM reaches states by sequential single-control clicks. NL can jump to compound states in one utterance, but may introduce mediator faults.", {
  x: 0.6, y: 4.75, w: 8.8, h: 0.6, fontSize: 10, fontFace: "Calibri", color: GRAY, italic: true, margin: 0,
});

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Results
// ════════════════════════════════════════════════════════════════════════════
const s3 = pres.addSlide();
s3.background = { color: BG };

s3.addText("Results: Reachability Comparison", {
  x: 0.5, y: 0.3, w: 9, h: 0.6,
  fontSize: 24, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0,
});

// Table
const tableRows = [
  [
    { text: "Metric", options: { fill: { color: "1E2030" }, color: GRAY, bold: true, fontSize: 11, align: "left" } },
    { text: "DM (depth=2)", options: { fill: { color: "1E2030" }, color: DM, bold: true, fontSize: 11, align: "center" } },
    { text: "NL", options: { fill: { color: "1E2030" }, color: NL, bold: true, fontSize: 11, align: "center" } },
  ],
  [
    { text: "Controls |C|", options: { color: LGRAY, fontSize: 11, align: "left" } },
    { text: "5", options: { color: WHITE, fontSize: 11, align: "center" } },
    { text: "5", options: { color: WHITE, fontSize: 11, align: "center" } },
  ],
  [
    { text: "States reached", options: { color: LGRAY, fontSize: 11, align: "left" } },
    { text: "129", options: { color: DM, fontSize: 14, bold: true, align: "center" } },
    { text: "8", options: { color: NL, fontSize: 14, bold: true, align: "center" } },
  ],
  [
    { text: "Controls exercised", options: { color: LGRAY, fontSize: 11, align: "left" } },
    { text: "5 (100%)", options: { color: WHITE, fontSize: 11, align: "center" } },
    { text: "5 (100%)", options: { color: WHITE, fontSize: 11, align: "center" } },
  ],
  [
    { text: "CovNL", options: { color: LGRAY, fontSize: 11, align: "left" } },
    { text: "—", options: { color: GRAY, fontSize: 11, align: "center" } },
    { text: "100%", options: { color: GREEN, fontSize: 12, bold: true, align: "center" } },
  ],
  [
    { text: "MR_SE violations", options: { color: LGRAY, fontSize: 11, align: "left" } },
    { text: "n/a", options: { color: GRAY, fontSize: 11, align: "center" } },
    { text: "1 (FAIL)", options: { color: RED, fontSize: 12, bold: true, align: "center" } },
  ],
];
s3.addTable(tableRows, {
  x: 1.5, y: 1.1, w: 7, colW: [3, 2, 2],
  border: { pt: 0.5, color: BORDER },
  fill: { color: CARD },
  rowH: [0.35, 0.32, 0.36, 0.32, 0.32, 0.32],
  fontFace: "Calibri",
});

// Key findings
s3.addText([
  { text: "DM explores 129 of 1,200 possible states at depth 2 (10.75% of state space)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "NL reaches only 8 unique states — but exercises ALL 5 controls (CovNL = 100%)", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "NL is efficient at reaching target states but covers far fewer combinations", options: { bullet: true, breakLine: true, fontSize: 11 } },
  { text: "MR_SE VIOLATION: CAPS variant produced different state — LLM is case-sensitive", options: { bullet: true, fontSize: 11, color: RED } },
], { x: 0.8, y: 3.55, w: 8.4, h: 1.8, color: LGRAY, fontFace: "Calibri", paraSpaceAfter: 5, valign: "top", margin: 0 });

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Interpreting the EFG
// ════════════════════════════════════════════════════════════════════════════
const s4 = pres.addSlide();
s4.background = { color: BG };

s4.addText("Interpreting the EFG", {
  x: 0.5, y: 0.3, w: 9, h: 0.6,
  fontSize: 24, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0,
});

// Node legend items as mini cards
const legendItems = [
  { color: GOLD, label: "Baseline σ₀", desc: "All defaults, 20 products visible", y: 1.1 },
  { color: GREEN, label: "Shared State", desc: "Reachable by BOTH DM and NL", y: 1.6 },
  { color: DM, label: "DM-only State", desc: "Compound combinations NL never produced", y: 2.1 },
  { color: NL, label: "NL-only State", desc: "Reached via chat but not by click sequence", y: 2.6 },
];

for (const item of legendItems) {
  s4.addShape(pres.shapes.OVAL, { x: 0.7, y: item.y + 0.05, w: 0.25, h: 0.25, fill: { color: BG2 }, line: { color: item.color, width: 2 } });
  s4.addText(item.label, { x: 1.1, y: item.y, w: 2.2, h: 0.3, fontSize: 12, fontFace: "Calibri", color: item.color, bold: true, margin: 0 });
  s4.addText(item.desc, { x: 1.1, y: item.y + 0.22, w: 3.5, h: 0.25, fontSize: 10, fontFace: "Calibri", color: GRAY, margin: 0 });
}

// Right column — interpretation points
const points = [
  { text: "Edges = single-action transitions (one control change or one NL utterance)", y: 1.1 },
  { text: "Bidirectional edges: e.g., books↔clothing = changing category from one to the other", y: 1.6 },
  { text: "Depth layers: radial rings — center=baseline, outer=compound states", y: 2.1 },
  { text: "Hash + count on nodes: e.g., '315c33 20p' = state ID + products visible", y: 2.6 },
];

for (const pt of points) {
  s4.addShape(pres.shapes.RECTANGLE, { x: 5.0, y: pt.y, w: 0.06, h: 0.35, fill: { color: DM } });
  s4.addText(pt.text, { x: 5.2, y: pt.y, w: 4.4, h: 0.4, fontSize: 10, fontFace: "Calibri", color: LGRAY, margin: 0, valign: "middle" });
}

// Bottom insight box
s4.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 3.5, w: 9.2, h: 1.5, fill: { color: "1E2030" }, line: { color: BORDER, width: 1 } });
s4.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 3.5, w: 0.06, h: 1.5, fill: { color: GREEN } });

s4.addText("Key Takeaway", {
  x: 0.7, y: 3.55, w: 8.7, h: 0.3, fontSize: 13, fontFace: "Calibri", color: GREEN, bold: true, margin: 0,
});
s4.addText(
  "The DM graph is dense because every control combination is reachable via clicks. " +
  "The NL graph is sparse — the LLM mediator maps utterances to a small subset of the state space. " +
  "This gap reveals both the efficiency of NL (fewer actions, targeted results) and its limitation " +
  "(reduced exploratory coverage for testing). Metamorphic relations like MR_SE can detect mediator " +
  "faults that functional testing alone would miss.",
  { x: 0.7, y: 3.85, w: 8.7, h: 1.0, fontSize: 11, fontFace: "Calibri", color: LGRAY, margin: 0, valign: "top" }
);

// ── Save ──
const outPath = "/Users/ninadpchaudhari/Desktop/projects/chat-assisted-ecommerce/.claude/worktrees/unruffled-wu/crawler/results_presentation.pptx";
pres.writeFile({ fileName: outPath }).then(() => {
  console.log("Saved: " + outPath);
}).catch(err => {
  console.error("Error:", err);
});
