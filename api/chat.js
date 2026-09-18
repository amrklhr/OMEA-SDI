// OMEA chat assistant — Claude Haiku with tool-calling over live OpenSearch data.
// Loops on tool_use until Claude gives a final text answer, then returns it.

import { TOOL_DEFINITIONS, executeTool, DATASET_START, DATASET_END, PUBLICATIONS } from "./_dataTools.js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ROUNDS = 5; // safety cap so a bad loop can't burn unlimited API calls

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

Always call a tool to answer questions about the data — never guess or make up numbers. If a question needs data outside your tools' scope, say so plainly rather than fabricating an answer.

Keep answers short and direct: 2 to 4 sentences for most questions, with the actual numbers. When relevant, note what the number implies rather than just repeating it back.

Known data quirk: June 2019 shows a volume spike across every topic. This is a corpus-wide collection artifact, not a real event. Mention this if a user asks about a spike or trend that includes June 2019.

Effectiveness metrics (coverage, sentiment, impressions, engagement) measure what was achieved. Efficiency metrics (CTR, EMV, ROI Index) measure cost-effectiveness relative to a paid-media baseline. Keep this distinction clear if asked to explain a metric.${situational}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Chat assistant not configured", detail: "ANTHROPIC_API_KEY is missing on the server." });
    return;
  }

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "No messages provided" });
    return;
  }

  try {
    const conversation = messages.map((m) => ({ role: m.role, content: m.content }));
    const system = buildSystemPrompt(context);

    let round = 0;
    while (round < MAX_TOOL_ROUNDS) {
      round++;
      const response = await callClaude(apiKey, system, conversation);

      if (response.stop_reason !== "tool_use") {
        const reply = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        res.status(200).json({ reply: reply || "I couldn't find an answer for that." });
        return;
      }

      // execute every tool_use block in this turn, then feed results back
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

    res.status(200).json({ reply: "That question needed too many steps to answer. Try breaking it into a simpler question." });
  } catch (err) {
    res.status(500).json({ error: "Chat request failed", detail: String(err.message || err) });
  }
}

async function callClaude(apiKey, system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  return res.json();
}
