// Server-side data tools for the OMEA chat assistant.
// Runs on Vercel, talks straight to Aiven OpenSearch with the same
// credentials used by api/search.js and api/msearch.js. Kept separate
// from src/opensearchClient.js because that file runs in the browser
// and goes through the /api proxy — this one IS the proxy's backend.

const INDEX = "omea-articles";
const DATASET_START = "2016-01-01";
const DATASET_END = "2019-07-13";
const PUBLICATIONS = ["Reuters", "Vox", "Vice", "TMZ", "Vice News", "Hyperallergic", "Business Insider"];

function openSearchUrl(path) {
  return `https://${process.env.AIVEN_HOST}:${process.env.AIVEN_PORT}${path}`;
}

function authHeader() {
  const token = Buffer.from(`${process.env.AIVEN_USER}:${process.env.AIVEN_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

async function runQuery(body) {
  const res = await fetch(openSearchUrl(`/${INDEX}/_search`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenSearch query failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// same topic + date range + publication filter used by the frontend client,
// duplicated here since this runs server-side and can't import it
function topicFilter(topic, from, to, publications) {
  const must = [];
  if (from || to) {
    const range = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    must.push({ range: { date: range } });
  }
  if (publications && publications.length > 0) {
    must.push({ terms: { publication: publications } });
  }
  return {
    bool: {
      must,
      should: [{ match: { title: topic } }, { match: { article: topic } }],
      minimum_should_match: 1,
    },
  };
}

// Anthropic tool schemas — passed to the Messages API as `tools`
export const TOOL_DEFINITIONS = [
  {
    name: "get_topic_summary",
    description: "Get overall KPIs (coverage volume, sentiment, impressions, engagement, CTR, EMV, ROI) for a topic or brand, optionally within a date range. Use this for questions like 'what is Facebook's ROI in 2018' or 'how much coverage did Amazon get'.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Brand, topic, or entity to search for" },
        from: { type: "string", description: "Start date YYYY-MM-DD, optional" },
        to: { type: "string", description: "End date YYYY-MM-DD, optional" },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_publication_breakdown",
    description: "Get per-publication KPIs (articles, sentiment, impressions, EMV, ROI) for a topic. Use this for questions like 'which publication has the best sentiment for X' or 'how does coverage break down by outlet'.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Brand, topic, or entity to search for" },
        from: { type: "string", description: "Start date YYYY-MM-DD, optional" },
        to: { type: "string", description: "End date YYYY-MM-DD, optional" },
      },
      required: ["topic"],
    },
  },
  {
    name: "compare_brands",
    description: "Compare coverage volume, sentiment, and ROI across 2 to 5 brands or topics side by side. Use this for questions like 'compare Facebook and Google' or 'which brand has better sentiment, Amazon or Apple'.",
    input_schema: {
      type: "object",
      properties: {
        brands: { type: "array", items: { type: "string" }, description: "2 to 5 brand or topic names" },
        from: { type: "string", description: "Start date YYYY-MM-DD, optional" },
        to: { type: "string", description: "End date YYYY-MM-DD, optional" },
      },
      required: ["brands"],
    },
  },
  {
    name: "get_coverage_trend",
    description: "Get monthly article counts for a topic, used to identify spikes or trend direction over time. Use this for questions like 'when did coverage of X spike' or 'is interest in Y growing or shrinking'.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Brand, topic, or entity to search for" },
        from: { type: "string", description: "Start date YYYY-MM-DD, optional" },
        to: { type: "string", description: "End date YYYY-MM-DD, optional" },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_top_keywords",
    description: "Get the words or phrases that appear unusually often alongside a topic, compared to the rest of the dataset. Use this for questions like 'what themes come up with X' or 'what is the coverage of Y actually about'.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Brand, topic, or entity to search for" },
        from: { type: "string", description: "Start date YYYY-MM-DD, optional" },
        to: { type: "string", description: "End date YYYY-MM-DD, optional" },
      },
      required: ["topic"],
    },
  },
];

// executes one tool call by name, returns a plain object (stringified before sending back to Claude)
export async function executeTool(name, input) {
  const from = input.from || undefined;
  const to = input.to || undefined;

  if (name === "get_topic_summary") {
    const data = await runQuery({
      size: 0,
      query: topicFilter(input.topic, from, to),
      aggs: {
        avg_sentiment: { avg: { field: "sentiment_score" } },
        total_impressions: { sum: { field: "estimated_impressions" } },
        avg_engagement_rate: { avg: { field: "engagement_rate" } },
        avg_ctr: { avg: { field: "ctr" } },
        total_emv: { sum: { field: "emv" } },
        avg_roi_index: { avg: { field: "roi_index" } },
      },
    });
    const a = data.aggregations;
    return {
      topic: input.topic,
      dateRange: `${from || DATASET_START} to ${to || DATASET_END}`,
      articleCount: data.hits.total.value,
      avgSentiment: round(a.avg_sentiment.value),
      totalImpressions: Math.round(a.total_impressions.value || 0),
      engagementRate: round(a.avg_engagement_rate.value),
      avgCtr: round(a.avg_ctr.value),
      totalEmv: round(a.total_emv.value, 2),
      roiIndex: round(a.avg_roi_index.value),
    };
  }

  if (name === "get_publication_breakdown") {
    const data = await runQuery({
      size: 0,
      query: topicFilter(input.topic, from, to),
      aggs: {
        by_publication: {
          terms: { field: "publication", size: 10 },
          aggs: {
            avg_sentiment: { avg: { field: "sentiment_score" } },
            total_impressions: { sum: { field: "estimated_impressions" } },
            total_emv: { sum: { field: "emv" } },
            avg_roi_index: { avg: { field: "roi_index" } },
          },
        },
      },
    });
    const buckets = data.aggregations.by_publication.buckets;
    return {
      topic: input.topic,
      dateRange: `${from || DATASET_START} to ${to || DATASET_END}`,
      publications: buckets.map((b) => ({
        publication: b.key,
        articles: b.doc_count,
        avgSentiment: round(b.avg_sentiment.value),
        totalImpressions: Math.round(b.total_impressions.value || 0),
        totalEmv: round(b.total_emv.value, 2),
        roiIndex: round(b.avg_roi_index.value),
      })),
    };
  }

  if (name === "compare_brands") {
    const brands = (input.brands || []).slice(0, 5);
    if (brands.length < 2) throw new Error("compare_brands needs at least 2 brand names");
    const results = await Promise.all(
      brands.map(async (brand) => {
        const data = await runQuery({
          size: 0,
          query: topicFilter(brand, from, to),
          aggs: {
            avg_sentiment: { avg: { field: "sentiment_score" } },
            total_emv: { sum: { field: "emv" } },
            avg_roi_index: { avg: { field: "roi_index" } },
          },
        });
        const a = data.aggregations;
        return {
          brand,
          articleCount: data.hits.total.value,
          avgSentiment: round(a.avg_sentiment.value),
          totalEmv: round(a.total_emv.value, 2),
          roiIndex: round(a.avg_roi_index.value),
        };
      })
    );
    return { dateRange: `${from || DATASET_START} to ${to || DATASET_END}`, brands: results };
  }

  if (name === "get_coverage_trend") {
    const data = await runQuery({
      size: 0,
      query: topicFilter(input.topic, from, to),
      aggs: {
        monthly: {
          date_histogram: { field: "date", calendar_interval: "month", format: "yyyy-MM" },
        },
      },
    });
    const buckets = data.aggregations.monthly.buckets;
    const counts = buckets.map((b) => b.doc_count);
    const mean = counts.reduce((s, v) => s + v, 0) / (counts.length || 1);
    const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / (counts.length || 1);
    const std = Math.sqrt(variance);
    const spikeMonths = buckets.filter((b) => b.doc_count > mean + 1.5 * std).map((b) => b.key_as_string);
    return {
      topic: input.topic,
      dateRange: `${from || DATASET_START} to ${to || DATASET_END}`,
      monthly: buckets.map((b) => ({ month: b.key_as_string, articles: b.doc_count })),
      detectedSpikes: spikeMonths,
      note: spikeMonths.includes("2019-06") ? "2019-06 is a known corpus-wide data collection artifact, not a real spike." : undefined,
    };
  }

  if (name === "get_top_keywords") {
    const data = await runQuery({
      size: 0,
      query: topicFilter(input.topic, from, to),
      aggs: {
        prominent_keywords: {
          significant_text: { field: "article", size: 10, exclude: [input.topic.toLowerCase()] },
        },
      },
    });
    const buckets = data.aggregations?.prominent_keywords?.buckets || [];
    return {
      topic: input.topic,
      dateRange: `${from || DATASET_START} to ${to || DATASET_END}`,
      keywords: buckets.map((b) => ({ keyword: b.key, articleCount: b.doc_count })),
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function round(v, digits = 3) {
  if (v === null || v === undefined) return 0;
  return Number(v.toFixed(digits));
}

export { PUBLICATIONS, DATASET_START, DATASET_END };
