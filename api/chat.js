// OMEA chat assistant.
//
// Two modes, picked automatically:
//   - No ANTHROPIC_API_KEY set: rule-based mode. We parse the question
//     ourselves with keyword matching, call the same OpenSearch tools
//     directly, and build the answer from a template. Zero API cost.
//   - ANTHROPIC_API_KEY set: Claude does the reasoning with tool-calling,
//     same tools, more flexible natural language. Costs a few cents per
//     conversation on Haiku pricing.
//
// Both modes return the same shape: { reply: string }. The frontend
// doesn't know or care which one answered.

import { TOOL_DEFINITIONS, executeTool, DATASET_START, DATASET_END, PUBLICATIONS } from "./_dataTools.js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ROUNDS = 5;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "No messages provided" });
    return;
  }
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    res.status(400).json({ error: "No user message found" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  try {
    if (apiKey) {
      const reply = await answerWithClaude(apiKey, messages, context);
      res.status(200).json({ reply });
    } else {
      const reply = await answerRuleBased(extractText(lastUserMessage.content), context);
      res.status(200).json({ reply });
    }
  } catch (err) {
    res.status(500).json({ error: "Chat request failed", detail: String(err.message || err) });
  }
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  return "";
}

// ---------- rule-based mode (default, free) ----------

const STOPWORDS = new Set([
  "What", "How", "Is", "The", "Show", "Which", "When", "Compare", "And", "For", "About",
  "Tell", "Me", "In", "On", "Of", "Are", "Was", "Were", "Does", "Did", "With", "To", "A", "An",
]);

// pulls capitalized words out of the message as brand/topic candidates —
// simple, no ML, but works fine for short questions like "how did Facebook do"
function extractCandidates(text) {
  const words = text.match(/[A-Z][a-zA-Z']+/g) || [];
  const seen = new Set();
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function detectIntent(text) {
  const m = text.toLowerCase();
  if (/\bcompare\b|\bvs\.?\b|\bversus\b/.test(m)) return "compare";
  if (/spike|trend|over time|growing|declining|increase|decrease|momentum/.test(m)) return "trend";
  if (/keyword|theme|what.*about|context|topics?\b/.test(m)) return "keywords";
  if (/publication|outlet|channel|which (one|publisher)/.test(m)) return "publications";
  return "summary";
}

function pct(x) {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

// dataset only covers 2016-01-01 through 2019-07-13 — clamp any year the
// user asks about to stay inside that window rather than silently return
// an empty or misleading range
function clampToDataset(dateStr) {
  if (dateStr < DATASET_START) return DATASET_START;
  if (dateStr > DATASET_END) return DATASET_END;
  return dateStr;
}

// pulls an explicit year or year range out of the question itself — e.g.
// "only for 2016" or "between 2016 and 2018" — so it overrides whatever
// the dashboard's own date picker currently shows. Without this, a
// question like "Clinton data only for 2016" silently used the dashboard's
// date range instead of the one actually asked for.
function extractDateRange(text) {
  const rangeMatch = text.match(/\b(201[6-9])\b\s*(?:to|-|–|through|and)\s*\b(201[6-9])\b/);
  if (rangeMatch) {
    let [y1, y2] = [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])];
    if (y1 > y2) [y1, y2] = [y2, y1];
    return { from: clampToDataset(`${y1}-01-01`), to: clampToDataset(`${y2}-12-31`) };
  }
  const yearMatch = text.match(/\b(201[6-9])\b/);
  if (yearMatch) {
    const y = yearMatch[1];
    return { from: clampToDataset(`${y}-01-01`), to: clampToDataset(`${y}-12-31`) };
  }
  return null;
}

async function answerRuleBased(text, context) {
  const intent = detectIntent(text);
  const candidates = extractCandidates(text);
  const explicitRange = extractDateRange(text);
  const from = explicitRange?.from || context?.dateFrom || undefined;
  const to = explicitRange?.to || context?.dateTo || undefined;
  const rangeLabel = `${from || DATASET_START} to ${to || DATASET_END}`;

  if (intent === "compare") {
    // try "compare X and Y" / "X vs Y" first, then fall back to any two capitalized candidates
    let a, b;
    const m = text.match(/compare\s+([A-Za-z0-9 ]+?)\s+(?:and|vs\.?|versus)\s+([A-Za-z0-9 ]+?)(?:[?.]|$)/i)
      || text.match(/([A-Za-z0-9 ]+?)\s+vs\.?\s+([A-Za-z0-9 ]+?)(?:[?.]|$)/i);
    if (m) { a = m[1].trim(); b = m[2].trim(); }
    else if (candidates.length >= 2) { a = candidates[0]; b = candidates[1]; }

    if (!a || !b) {
      return `I couldn't tell which two brands to compare. Try something like "compare Facebook and Google".`;
    }
    const result = await executeTool("compare_brands", { brands: [a, b], from, to });
    const [x, y] = result.brands;
    const volLeader = x.articleCount >= y.articleCount ? x : y;
    const sentLeader = x.avgSentiment >= y.avgSentiment ? x : y;
    return `Between ${rangeLabel}: ${x.brand} had ${x.articleCount} articles (sentiment ${pct(x.avgSentiment)}, ROI ${pct(x.roiIndex)}) vs ${y.brand} with ${y.articleCount} articles (sentiment ${pct(y.avgSentiment)}, ROI ${pct(y.roiIndex)}). ${volLeader.brand} leads on coverage volume, ${sentLeader.brand} leads on sentiment.`;
  }

  const topic = candidates[0] || context?.topic;
  if (!topic) {
    return `I need a topic to look up. Try something like "what's the sentiment for Facebook" or search a topic on the dashboard first.`;
  }

  if (intent === "trend") {
    const result = await executeTool("get_coverage_trend", { topic, from, to });
    const monthly = result.monthly;
    if (monthly.length === 0) return `No coverage found for "${topic}" in ${rangeLabel}.`;
    const half = Math.floor(monthly.length / 2);
    const firstHalfAvg = monthly.slice(0, half).reduce((s, m) => s + m.articles, 0) / (half || 1);
    const secondHalfAvg = monthly.slice(half).reduce((s, m) => s + m.articles, 0) / (monthly.length - half || 1);
    const direction = secondHalfAvg > firstHalfAvg * 1.15 ? "rising" : secondHalfAvg < firstHalfAvg * 0.85 ? "declining" : "roughly stable";
    let reply = `Coverage of "${topic}" is ${direction} over ${rangeLabel} (early average ${firstHalfAvg.toFixed(1)}/month vs recent average ${secondHalfAvg.toFixed(1)}/month).`;
    if (result.detectedSpikes.length > 0) {
      reply += ` Spikes detected in: ${result.detectedSpikes.join(", ")}.`;
    }
    if (result.note) reply += ` Note: ${result.note}`;
    return reply;
  }

  if (intent === "keywords") {
    const result = await executeTool("get_top_keywords", { topic, from, to });
    if (result.keywords.length === 0) return `No strongly associated keywords found for "${topic}" in ${rangeLabel}.`;
    const top = result.keywords.slice(0, 6).map((k) => k.keyword).join(", ");
    return `Coverage of "${topic}" most often mentions: ${top}.`;
  }

  if (intent === "publications") {
    const result = await executeTool("get_publication_breakdown", { topic, from, to });
    if (result.publications.length === 0) return `No coverage found for "${topic}" in ${rangeLabel}.`;
    const sorted = [...result.publications].sort((a, b) => b.avgSentiment - a.avgSentiment);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const list = result.publications.map((p) => `${p.publication} (${p.articles} articles, ${pct(p.avgSentiment)})`).join("; ");
    return `For "${topic}" in ${rangeLabel}: ${list}. ${best.publication} has the most favorable sentiment, ${worst.publication} the least.`;
  }

  // default: summary
  const result = await executeTool("get_topic_summary", { topic, from, to });
  if (result.articleCount === 0) return `No coverage found for "${topic}" in ${rangeLabel}. Try a different topic or widen the date range.`;
  return `"${topic}" had ${result.articleCount} articles in ${rangeLabel}, averaging ${pct(result.avgSentiment)} sentiment. Estimated ${result.totalImpressions.toLocaleString()} impressions, $${result.totalEmv.toFixed(0)} earned media value, ROI Index ${pct(result.roiIndex)}.`;
}

// ---------- Claude tool-calling mode (optional, used only if a key is set) ----------

function buildSystemPrompt(context) {
  const pubList = PUBLICATIONS.join(", ");
  let situational = "";
  if (context?.topic) {
    situational = `\n\nThe user is currently viewing the dashboard filtered to topic "${context.topic}"`;
    if (context.dateFrom || context.dateTo) {
      situational += ` for the date range ${context.dateFrom || DATASET_START} to ${context.dateTo || DATASET_END}`;
    }
    if (context.selectedPubs && context.selectedPubs.length > 0) {
      situational += `, channels: ${context.selectedPubs.join(", ")}`;
    }
    situational += ". If the user asks a question without naming a topic, assume they mean this one.";
  }
  return `You are the OMEA data assistant, embedded in a media effectiveness analytics dashboard.

The dataset is "All the News 2.0": ${pubList} — ${DATASET_START} to ${DATASET_END}. There is no data outside this range or these publications.

Always call a tool to answer questions about the data — never guess or make up numbers.

Keep answers short and direct: 2 to 4 sentences for most questions, with the actual numbers.

Known data quirk: June 2019 shows a volume spike across every topic. This is a corpus-wide collection artifact, not a real event.

Effectiveness metrics (coverage, sentiment, impressions, engagement) measure what was achieved. Efficiency metrics (CTR, EMV, ROI Index) measure cost-effectiveness relative to a paid-media baseline.${situational}`;
}

async function answerWithClaude(apiKey, messages, context) {
  const conversation = messages.map((m) => ({ role: m.role, content: m.content }));
  const system = buildSystemPrompt(context);

  let round = 0;
  while (round < MAX_TOOL_ROUNDS) {
    round++;
    const response = await callClaude(apiKey, system, conversation);

    if (response.stop_reason !== "tool_use") {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return reply || "I couldn't find an answer for that.";
    }

    conversation.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const result = await executeTool(block.name, block.input);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
      }
    }
    conversation.push({ role: "user", content: toolResults });
  }
  return "That question needed too many steps to answer. Try breaking it into a simpler question.";
}

async function callClaude(apiKey, system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages, tools: TOOL_DEFINITIONS }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  return res.json();
}
