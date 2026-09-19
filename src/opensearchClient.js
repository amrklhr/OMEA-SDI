// Live OpenSearch client for OMEA.
// These functions implement the exact queries documented in
// OMEA_query_dsl_reference.md, validated earlier against the real dataset.

const OPENSEARCH_URL = "http://localhost:9200";
const INDEX = "omea-articles";

// In production (deployed on Vercel), route through the secure proxy
// functions instead of hitting OpenSearch directly — this keeps your Aiven
// credentials server-side. Locally, keep talking straight to Docker as
// before, so the existing local dev workflow is unaffected.
const IS_PROD = import.meta.env.PROD;

async function runQuery(body) {
  const url = IS_PROD ? "/api/search" : `${OPENSEARCH_URL}/${INDEX}/_search`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenSearch query failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function runMsearch(ndjsonLines) {
  const url = IS_PROD ? "/api/msearch" : `${OPENSEARCH_URL}/_msearch`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjsonLines.join("\n") + "\n",
  });
  if (!res.ok) throw new Error(`OpenSearch msearch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Builds the topic + optional date-range + optional channel filter shared by
 * every query. This is the single place that enforces "all filters apply
 * everywhere" — any new query built on top of this automatically respects
 * the date range, interval, and selected publications.
 * dateRange: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
 * publications: string[] | null — restrict to these publications if given
 */
function topicFilter(topic, dateRange = {}, publications = null) {
  const must = [];
  if (dateRange.from || dateRange.to) {
    const range = {};
    if (dateRange.from) range.gte = dateRange.from;
    if (dateRange.to) range.lte = dateRange.to;
    must.push({ range: { date: range } });
  }
  if (publications && publications.length > 0) {
    must.push({ terms: { publication: publications } });
  }
  return {
    bool: {
      must,
      should: [
        { match: { title: topic } },
        { match: { article: topic } },
      ],
      minimum_should_match: 1,
    },
  };
}

// OpenSearch's calendar_interval accepts "month", "quarter", "year" directly.
const DATE_FORMAT_FOR_INTERVAL = {
  month: "yyyy-MM",
  quarter: "yyyy-MM",
  year: "yyyy",
};

/** KPI summary — feeds the Marketing Owner cards. */
export async function fetchSummary(topic, dateRange = {}) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange),
    aggs: {
      avg_sentiment: { avg: { field: "sentiment_score" } },
      total_impressions: { sum: { field: "estimated_impressions" } },
      avg_engagement_rate: { avg: { field: "engagement_rate" } },
      avg_ctr: { avg: { field: "ctr" } },
      avg_cpe: { avg: { field: "cpe" } },
      total_emv: { sum: { field: "emv" } },
      avg_roi_index: { avg: { field: "roi_index" } },
    },
  };
  const data = await runQuery(body);
  const a = data.aggregations;
  return {
    volume: data.hits.total.value,
    sentiment: a.avg_sentiment.value ?? 0,
    impressions: a.total_impressions.value ?? 0,
    engagement: a.avg_engagement_rate.value ?? 0,
    ctr: a.avg_ctr.value ?? 0,
    cpe: a.avg_cpe.value ?? 0,
    emv: a.total_emv.value ?? 0,
    roi: a.avg_roi_index.value ?? 0,
  };
}

/**
 * Computes a prior-period date range of the same length as the current one,
 * so KPI cards can show delta vs. the period immediately before.
 * e.g. if dateRange is 2018-01-01 to 2018-12-31 (365 days),
 * prior range is 2017-01-01 to 2017-12-31.
 * Falls back to a fixed 6-month window when no explicit range is given.
 */
export function computePriorDateRange(dateRange = {}) {
  const DATASET_START = "2016-01-01";
  const from = dateRange.from || DATASET_START;
  const to = dateRange.to || "2019-07-13";
  const msFrom = new Date(from).getTime();
  const msTo = new Date(to).getTime();
  const duration = msTo - msFrom;
  const priorTo = new Date(msFrom - 1).toISOString().slice(0, 10);
  const priorFrom = new Date(msFrom - duration - 1).toISOString().slice(0, 10);
  // clamp so we never go before the dataset
  if (new Date(priorFrom) < new Date(DATASET_START)) return null;
  return { from: priorFrom, to: priorTo };
}

/**
 * Runs fetchSummary for the prior period so KPI cards can compute delta.
 * Returns null when no prior period exists within the dataset.
 */
export async function fetchPriorPeriodSummary(topic, dateRange = {}, publications = null) {
  const prior = computePriorDateRange(dateRange);
  if (!prior) return null;
  const body = {
    size: 0,
    query: topicFilter(topic, prior, publications),
    aggs: {
      avg_sentiment: { avg: { field: "sentiment_score" } },
      total_impressions: { sum: { field: "estimated_impressions" } },
      avg_engagement_rate: { avg: { field: "engagement_rate" } },
      total_emv: { sum: { field: "emv" } },
      avg_roi_index: { avg: { field: "roi_index" } },
    },
  };
  const data = await runQuery(body);
  const a = data.aggregations;
  return {
    volume: data.hits.total.value,
    sentiment: a.avg_sentiment.value ?? 0,
    impressions: a.total_impressions.value ?? 0,
    engagement: a.avg_engagement_rate.value ?? 0,
    emv: a.total_emv.value ?? 0,
    roi: a.avg_roi_index.value ?? 0,
  };
}

/**
 * Monthly/quarterly/yearly coverage volume, broken down per publication —
 * lets the trend chart respond to the channel filter without an extra query
 * per click. Returns { [publicationName]: { [periodKey]: count } }.
 */
export async function fetchMonthlyVolumeByPublication(topic, dateRange = {}, interval = "month") {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange),
    aggs: {
      by_publication: {
        terms: { field: "publication", size: 30 },
        aggs: {
          periods: {
            date_histogram: { field: "date", calendar_interval: interval, format },
          },
        },
      },
    },
  };
  const data = await runQuery(body);
  const result = {};
  for (const pubBucket of data.aggregations.by_publication.buckets) {
    const periods = {};
    for (const periodBucket of pubBucket.periods.buckets) {
      periods[periodBucket.key_as_string] = periodBucket.doc_count;
    }
    result[pubBucket.key] = periods;
  }
  return result;
}

/**
 * Monthly/quarterly/yearly EMV (Earned Media Value) broken down per
 * publication — feeds the "Revenue generated" chart. Same structure as
 * fetchMonthlyVolumeByPublication but summing emv instead of counting docs.
 */
/**
 * Full multi-KPI breakdown by publication and period, in one query — feeds
 * the Data Analyst's clustered comparison chart. Returns
 * { [publication]: { [period]: { volume, sentiment, impressions, engagement, ctr, emv, roi } } }
 * so switching which KPI is displayed doesn't require a new request.
 */
export async function fetchMonthlyKpiBreakdown(topic, dateRange = {}, interval = "month", publications = null) {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: {
      by_publication: {
        terms: { field: "publication", size: 30 },
        aggs: {
          periods: {
            date_histogram: { field: "date", calendar_interval: interval, format },
            aggs: {
              avg_sentiment: { avg: { field: "sentiment_score" } },
              total_impressions: { sum: { field: "estimated_impressions" } },
              avg_engagement_rate: { avg: { field: "engagement_rate" } },
              avg_ctr: { avg: { field: "ctr" } },
              total_emv: { sum: { field: "emv" } },
              avg_roi_index: { avg: { field: "roi_index" } },
            },
          },
        },
      },
    },
  };
  const data = await runQuery(body);
  const result = {};
  for (const pubBucket of data.aggregations.by_publication.buckets) {
    const periods = {};
    for (const pb of pubBucket.periods.buckets) {
      periods[pb.key_as_string] = {
        volume: pb.doc_count,
        sentiment: pb.avg_sentiment.value ?? 0,
        impressions: pb.total_impressions.value ?? 0,
        engagement: pb.avg_engagement_rate.value ?? 0,
        ctr: pb.avg_ctr.value ?? 0,
        emv: pb.total_emv.value ?? 0,
        roi: pb.avg_roi_index.value ?? 0,
      };
    }
    result[pubBucket.key] = periods;
  }
  return result;
}

export async function fetchMonthlyEmvByPublication(topic, dateRange = {}, interval = "month") {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange),
    aggs: {
      by_publication: {
        terms: { field: "publication", size: 30 },
        aggs: {
          periods: {
            date_histogram: { field: "date", calendar_interval: interval, format },
            aggs: { total_emv: { sum: { field: "emv" } } },
          },
        },
      },
    },
  };
  const data = await runQuery(body);
  const result = {};
  for (const pubBucket of data.aggregations.by_publication.buckets) {
    const periods = {};
    for (const periodBucket of pubBucket.periods.buckets) {
      periods[periodBucket.key_as_string] = periodBucket.total_emv.value ?? 0;
    }
    result[pubBucket.key] = periods;
  }
  return result;
}

/** Same shape as fetchMonthlyEmvByPublication but summing impressions instead of EMV — feeds the Coverage + Impressions combo chart. */
export async function fetchMonthlyImpressionsByPublication(topic, dateRange = {}, interval = "month") {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange),
    aggs: {
      by_publication: {
        terms: { field: "publication", size: 30 },
        aggs: {
          periods: {
            date_histogram: { field: "date", calendar_interval: interval, format },
            aggs: { total_impressions: { sum: { field: "estimated_impressions" } } },
          },
        },
      },
    },
  };
  const data = await runQuery(body);
  const result = {};
  for (const pubBucket of data.aggregations.by_publication.buckets) {
    const periods = {};
    for (const periodBucket of pubBucket.periods.buckets) {
      periods[periodBucket.key_as_string] = periodBucket.total_impressions.value ?? 0;
    }
    result[pubBucket.key] = periods;
  }
  return result;
}


export async function fetchPublicationBreakdown(topic, dateRange = {}) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange),
    aggs: {
      by_publication: {
        terms: { field: "publication", size: 30 },
        aggs: {
          avg_sentiment: { avg: { field: "sentiment_score" } },
          total_impressions: { sum: { field: "estimated_impressions" } },
          avg_engagement_rate: { avg: { field: "engagement_rate" } },
          avg_roi_index: { avg: { field: "roi_index" } },
          avg_cpe: { avg: { field: "cpe" } },
          total_emv: { sum: { field: "emv" } },
        },
      },
    },
  };
  const data = await runQuery(body);
  return data.aggregations.by_publication.buckets.map((b) => ({
    name: b.key,
    articles: b.doc_count,
    sentiment: b.avg_sentiment.value ?? 0,
    engagement: b.avg_engagement_rate.value ?? 0,
    impressions: b.total_impressions.value ?? 0,
    emv: b.total_emv.value ?? 0,
    roi: b.avg_roi_index.value ?? 0,
    cpe: b.avg_cpe.value ?? 0,
  }));
}

/**
 * Sentiment distribution — buckets every matched article by sentiment range
 * (e.g. -1.0 to -0.8, ... 0.8 to 1.0). Reveals the *shape* of sentiment,
 * which a single average can hide (e.g. a 0.0 average could mean "all
 * neutral" or "a even split of strongly positive and strongly negative").
 */
export async function fetchSentimentDistribution(topic, dateRange = {}, publications = null) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: {
      sentiment_histogram: {
        histogram: {
          field: "sentiment_score",
          interval: 0.2,
          extended_bounds: { min: -1, max: 0.8 },
        },
      },
    },
  };
  const data = await runQuery(body);
  const buckets = data.aggregations?.sentiment_histogram?.buckets || [];
  return buckets.map((b) => ({ bucketStart: b.key, count: b.doc_count }));
}

/**
 * Article count and total impressions, bucketed every 0.1 sentiment point
 * from -1.0 to 1.0 (20 buckets) — finer-grained than the 0.2 buckets used
 * elsewhere, since this chart's whole point is spotting which narrow
 * sentiment range punches above its article count in reach. Estimated
 * Impressions is a formula of reach_tier and section_weight only (see How
 * It Works), not sentiment, so any pattern here reflects which
 * publications/sections happen to write at that sentiment level — a real
 * finding, not a formula artifact like the ROI-sentiment relationship.
 */
export async function fetchSentimentImpressionBuckets(topic, dateRange = {}, publications = null) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: {
      buckets: {
        histogram: { field: "sentiment_score", interval: 0.1, extended_bounds: { min: -1, max: 0.9 } },
        aggs: { total_impressions: { sum: { field: "estimated_impressions" } } },
      },
    },
  };
  const data = await runQuery(body);
  const buckets = data.aggregations?.buckets?.buckets || [];
  return buckets.map((b) => ({
    bucketStart: Math.round(b.key * 10) / 10, // avoid floating point noise like 0.30000000000000004
    count: b.doc_count,
    totalImpressions: b.total_impressions.value ?? 0,
  }));
}

/**
 * A sample of individual articles with per-article fields — feeds the
 * sentiment-vs-ROI and word-count-vs-engagement scatter plots. One query
 * serves both charts since they need the same underlying article-level data.
 */
export async function fetchArticleSample(topic, dateRange = {}, publications = null, size = 400) {
  const body = {
    size,
    query: topicFilter(topic, dateRange, publications),
    _source: ["publication", "sentiment_score", "roi_index", "word_count", "engagement_rate"],
  };
  const data = await runQuery(body);
  // return { articles, totalMatched } so scatter charts can show
  // sampled N of M when result is capped at size
  return {
    articles: data.hits.hits.map((h) => h._source),
    totalMatched: data.hits.total.value,
  };
}

/**
 * Top and bottom performing articles by ROI Index — feeds the spotlight
 * card. Uses the same explainability fields as the drill-down panel.
 */
export async function fetchPerformanceSpotlight(topic, dateRange = {}) {
  const fields = [
    "title", "publication", "date", "section", "sentiment_score",
    "reach_tier", "estimated_impressions", "engagement_rate", "ctr", "cpe", "emv", "roi_index",
  ];
  // exclude articles with perfectly extreme sentiment (±1.0) — they produce
  // trivial ±100% ROI that is a formula artifact, not a real signal
  const nonExtreme = {
    bool: {
      must: [topicFilter(topic, dateRange)],
      must_not: [
        { term: { sentiment_score: 1.0 } },
        { term: { sentiment_score: -1.0 } },
      ],
    },
  };
  const [topRes, bottomRes] = await Promise.all([
    runQuery({
      size: 1,
      query: nonExtreme,
      sort: [{ roi_index: { order: "desc" } }],
      _source: fields,
    }),
    runQuery({
      size: 1,
      query: nonExtreme,
      sort: [{ roi_index: { order: "asc" } }],
      _source: fields,
    }),
  ]);
  const top = topRes.hits.hits[0]?._source || null;
  const bottom = bottomRes.hits.hits[0]?._source || null;
  return { top, bottom };
}

/**
 * For each keyword, finds one real example article (title + a highlighted
 * snippet) that mentions both the topic and that keyword — this is what
 * turns a bare keyword list into inspectable context. Batches all keyword
 * lookups into a single _msearch request rather than one round-trip per
 * keyword.
 */
export async function fetchKeywordContexts(topic, keywordKeys, dateRange = {}, publications = null) {
  if (keywordKeys.length === 0) return {};

  const ndjsonLines = [];
  for (const kw of keywordKeys) {
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 1,
      query: {
        bool: {
          must: [topicFilter(topic, dateRange, publications), { match_phrase: { article: kw } }],
        },
      },
      highlight: {
        fields: { article: { fragment_size: 160, number_of_fragments: 1 } },
      },
      _source: ["title", "publication", "date"],
    }));
  }
  const data = await runMsearch(ndjsonLines);

  const contexts = {};
  data.responses.forEach((resp, i) => {
    const hit = resp.hits?.hits?.[0];
    contexts[keywordKeys[i]] = hit
      ? {
          title: hit._source.title,
          publication: hit._source.publication,
          snippet: hit.highlight?.article?.[0] || null,
        }
      : null;
  });
  return contexts;
}

/**
 * Monthly/quarterly/yearly article volume broken down by editorial section
 * — feeds the "Discussion contexts" stacked column chart. Absolute counts,
 * not normalized, so overall volume is still visible alongside composition.
 */
export async function fetchMonthlyVolumeBySection(topic, dateRange = {}, interval = "month", publications = null) {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: {
      by_section: {
        terms: { field: "section", size: 10 },
        aggs: {
          periods: { date_histogram: { field: "date", calendar_interval: interval, format } },
        },
      },
    },
  };
  const data = await runQuery(body);
  const result = {};
  for (const bucket of data.aggregations.by_section.buckets) {
    const periods = {};
    for (const pb of bucket.periods.buckets) periods[pb.key_as_string] = pb.doc_count;
    result[bucket.key] = periods;
  }
  return result;
}

/**
 * "Discussion contexts" — breaks down which editorial sections (Politics,
 * Business, Entertainment, etc.) this topic is covered in. Unlike the
 * keyword/phrase mining below, this uses real structured metadata rather
 * than free text, so it's immune to syndication-footer noise. Now respects
 * the channel (publication) filter, same as every other chart.
 */
export async function fetchContextBreakdown(topic, dateRange = {}, interval = "month", publications = null) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: {
      by_section: { terms: { field: "section", size: 10 } },
    },
  };
  const data = await runQuery(body);
  const buckets = data.aggregations?.by_section?.buckets || [];
  const sections = buckets.map((b) => ({ name: b.key, count: b.doc_count }));

  if (sections.length === 0) {
    return { sections: [], totalMatched: data.hits.total.value, monthlyBySection: {} };
  }

  const ndjsonLines = [];
  for (const s of sections) {
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 1,
      query: { bool: { must: [topicFilter(topic, dateRange, publications), { term: { section: s.name } }] } },
      highlight: {
        fields: {
          article: { fragment_size: 160, number_of_fragments: 1, highlight_query: { match: { article: topic } } },
        },
      },
      _source: ["title", "publication", "date"],
    }));
  }

  const [monthlyBySection, msearchResult] = await Promise.all([
    fetchMonthlyVolumeBySection(topic, dateRange, interval, publications),
    runMsearch(ndjsonLines),
  ]);

  const withContext = sections.map((s, i) => {
    const hit = msearchResult.responses[i]?.hits?.hits?.[0];
    return {
      ...s,
      context: hit
        ? { title: hit._source.title, publication: hit._source.publication, snippet: hit.highlight?.article?.[0] || null }
        : null,
    };
  });

  return { sections: withContext, totalMatched: data.hits.total.value, monthlyBySection };
}

/**
 * Article list for a specific keyword/phrase — feeds the expandable
 * "view articles" list under each keyword result. Returns just title and
 * publication, kept lightweight since it's a browsable list, not a
 * detailed drill-down.
 */
export async function fetchArticlesForKeyword(topic, keyword, dateRange = {}, publications = null, size = 25) {
  const body = {
    size,
    query: {
      bool: {
        must: [topicFilter(topic, dateRange, publications), { match_phrase: { article: keyword } }],
      },
    },
    _source: ["title", "publication"],
  };
  const data = await runQuery(body);
  return data.hits.hits.map((h) => h._source);
}

/**
 * Article list for a specific editorial section — feeds the expandable
 * "view articles" list under each Discussion Contexts result.
 */
export async function fetchArticlesForSection(topic, section, dateRange = {}, publications = null, size = 25) {
  const body = {
    size,
    query: {
      bool: {
        must: [topicFilter(topic, dateRange, publications), { term: { section } }],
      },
    },
    _source: ["title", "publication"],
  };
  const data = await runQuery(body);
  return data.hits.hits.map((h) => h._source);
}

const PHRASE_FIELD = {
  1: "article",
  2: "article.bigram",
  3: "article.trigram",
  4: "article.quadgram",
};

/**
 * Related/prominent keywords — terms (or multi-word phrases) that appear
 * unusually often in articles about this topic compared to the whole index.
 * phraseLength selects single words (1) or 2/3/4-word shingled phrases,
 * using the dedicated analyzed sub-fields built at ingestion time. Now
 * respects the channel (publication) filter too.
 */
// Common English connector/relational words — filtered out of 2/3/4-word
// phrase results so "Facebook and Cambridge" doesn't show up as a keyword
// alongside genuinely meaningful phrases like "Facebook scandal". This is
// the standard English stopword list (articles, prepositions, pronouns,
// auxiliary verbs, conjunctions), not just a handful of examples.
const STOPWORDS = new Set([
  "a", "an", "the",
  "and", "or", "but", "nor", "so", "yet", "if", "because", "as", "than", "then",
  "of", "in", "on", "at", "to", "for", "with", "by", "from", "into",
  "over", "under", "about", "against", "between", "through", "during",
  "before", "after", "above", "below", "up", "down", "out", "off",
  "again", "further", "once", "here", "there", "when", "where", "why", "how",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "doing", "have", "has", "had", "having",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those", "who", "whom", "which", "what",
  "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "not", "only", "own", "same", "too", "very", "just",
  // contractions — the analyzer keeps these as single tokens with the
  // apostrophe intact, so they never matched the plain STOPWORDS above
  "don't", "doesn't", "didn't", "isn't", "wasn't", "aren't", "weren't",
  "can't", "couldn't", "won't", "wouldn't", "shouldn't", "haven't", "hasn't",
  "it's", "that's", "there's", "here's", "what's", "who's", "let's",
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
  "he's", "she's", "we're", "we've", "we'll", "they're", "they've", "they'll",
  // generic conversational filler — grammatically fine, but say nothing
  // about what a topic's coverage is actually about
  "like", "get", "got", "getting", "one", "know", "going", "go", "goes", "went",
  "really", "actually", "thing", "things", "said", "says", "say", "saying",
  "way", "also", "back", "even", "still", "much", "many", "well", "good",
  "first", "last", "new", "old", "us", "make", "made", "making", "take",
  "took", "taken", "come", "came", "see", "seen", "look", "looking", "want",
  "need", "using", "used", "use",
  // syndication/publishing boilerplate — the actual source of the noise
  // reported in this project's word cloud: shared footer/byline text
  // ("this story originally appeared on X", "follow us on Twitter") is
  // genuinely unusually frequent within a topic if many of its articles
  // share the same syndication template, so significant_text correctly
  // flags it as "significant" even though it's not about the topic at all
  "originally", "appeared", "follow", "following", "subscribe", "subscribed",
  "click", "read", "reading", "share", "shared", "sharing", "comment",
  "comments", "commenting", "tweet", "tweeted", "tweets", "post", "posted",
  "posting", "article", "articles", "story", "stories", "page", "pages",
  "content", "published", "publish", "editor", "correction", "updated",
  "update", "via", "photo", "photos", "image", "images", "video", "videos",
  "watch", "watched", "app", "mobile",
]);

// domain-like tokens ("recode.net", "vice.com") slip past ordinary
// stopword filtering since they're not stopwords — they're syndication
// footer artifacts ("this story originally appeared on recode.net").
// Real single content words never contain a literal period.
function looksLikeDomain(word) {
  return /\./.test(word);
}

function containsStopword(phrase) {
  return phrase.split(/\s+/).some((word) => STOPWORDS.has(word.toLowerCase()) || looksLikeDomain(word));
}

/**
 * Terms for the word cloud visual — single words only (word clouds don't
 * read well with multi-word phrases), no per-word context lookup (unlike
 * Related Keywords), so this stays a single cheap query even at 25 terms.
 */
export async function fetchWordCloudTerms(topic, dateRange = {}, publications = null, size = 25) {
  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    // fetch generously past `size` — filtering out boilerplate/filler
    // below can remove a large share of raw candidates
    aggs: {
      cloud_terms: { significant_text: { field: "article", size: size * 3, exclude: [topic.toLowerCase()] } },
    },
  };
  const data = await runQuery(body);
  const buckets = data.aggregations?.cloud_terms?.buckets || [];
  return buckets
    .filter((b) => !containsStopword(b.key))
    .slice(0, size)
    .map((b) => ({ key: b.key, docCount: b.doc_count }));
}

export async function fetchKeywordProminence(topic, phraseLength = 1, dateRange = {}, publications = null) {
  const field = PHRASE_FIELD[phraseLength] || "article";
  // Fetch extra candidates up front for every phrase length, single words
  // included — some will be filtered out below for being a connector word,
  // a contraction, or syndication boilerplate ("originally", "appeared",
  // "follow") — this keeps the final result count close to a full 10 after
  // filtering, whereas the single-word path previously skipped this filter
  // entirely and let that boilerplate straight through.
  const fetchSize = 30;
  const sigTextAgg = { field, size: fetchSize };
  // Only exclude the topic term itself for single-word mode — for phrases,
  // terms like "facebook scandal" that include the topic are exactly the
  // interesting ones and should be kept.
  if (phraseLength === 1) sigTextAgg.exclude = [topic.toLowerCase()];

  const body = {
    size: 0,
    query: topicFilter(topic, dateRange, publications),
    aggs: { prominent_keywords: { significant_text: sigTextAgg } },
  };
  const data = await runQuery(body);
  const buckets = data.aggregations?.prominent_keywords?.buckets || [];
  let keywords = buckets.map((b) => ({ key: b.key, score: b.score, docCount: b.doc_count }));

  keywords = keywords.filter((k) => !containsStopword(k.key)).slice(0, 10);

  const contexts = await fetchKeywordContexts(topic, keywords.map((k) => k.key), dateRange, publications);
  return keywords.map((k) => ({ ...k, context: contexts[k.key] }));
}

// ---------- Best & Worst: top/bottom performing titles ----------
//
// Ranks the actual articles matching the current topic search by a chosen
// KPI (sentiment, impressions, or engagement) — a plain sort query, not an
// aggregation. Far simpler and far more reliable than mining "subjects"
// with significant_text, which proved too expensive on multi-word shingle
// fields for this OpenSearch instance to complete reliably. This directly
// answers "which pieces of content performed best/worst" using real
// per-article values, no keyword mining involved.
const RANKING_SORT_FIELD = {
  sentiment: "sentiment_score",
  impressions: "estimated_impressions",
  engagement: "engagement_rate",
};

export async function fetchTopicTitleRankings(topic, dateRange = {}, publications = null, metric = "sentiment", size = 20) {
  const sortField = RANKING_SORT_FIELD[metric] || "sentiment_score";
  const query = topicFilter(topic, dateRange, publications);
  const fields = ["title", "publication", "date", "sentiment_score", "estimated_impressions", "engagement_rate", "roi_index"];

  const ndjsonLines = [
    JSON.stringify({ index: INDEX }),
    JSON.stringify({ size, query, sort: [{ [sortField]: { order: "desc" } }], _source: fields }),
    JSON.stringify({ index: INDEX }),
    JSON.stringify({ size, query, sort: [{ [sortField]: { order: "asc" } }], _source: fields }),
  ];
  const result = await runMsearch(ndjsonLines);
  const [topRes, bottomRes] = result.responses;

  return {
    topic,
    dateRange,
    metric,
    totalMatched: topRes.hits.total.value,
    top: topRes.hits.hits.map((h) => h._source),
    bottom: bottomRes.hits.hits.map((h) => h._source),
  };
}

/**
 * Every article matching the current topic and date range, for CSV export
 * from Best & Worst — not just the top/bottom 20 shown on screen. Capped
 * at OpenSearch's default max_result_window (10,000); if a topic somehow
 * matches more than that, only the first 10,000 by date are returned and
 * totalMatched will read higher than articles.length so the caller can
 * warn the user.
 */
export async function fetchAllTopicArticles(topic, dateRange = {}, publications = null) {
  const CAP = 10000;
  const query = topicFilter(topic, dateRange, publications);
  const fields = ["title", "publication", "date", "sentiment_score", "estimated_impressions", "emv", "engagement_rate"];
  const data = await runQuery({
    size: CAP,
    query,
    sort: [{ date: { order: "desc" } }],
    _source: fields,
  });
  return {
    totalMatched: data.hits.total.value,
    articles: data.hits.hits.map((h) => h._source),
  };
}

/** Fetches everything a topic search needs, in parallel (keywords/contexts load separately). */
export async function fetchTopicData(topic, dateRange = {}, interval = "month") {
  const [summary, monthlyByPublication, monthlyEmvByPublication, monthlyImpressionsByPublication, publications, spotlight] = await Promise.all([
    fetchSummary(topic, dateRange),
    fetchMonthlyVolumeByPublication(topic, dateRange, interval),
    fetchMonthlyEmvByPublication(topic, dateRange, interval),
    fetchMonthlyImpressionsByPublication(topic, dateRange, interval),
    fetchPublicationBreakdown(topic, dateRange),
    fetchPerformanceSpotlight(topic, dateRange),
  ]);
  return { label: topic, summary, monthlyByPublication, monthlyEmvByPublication, monthlyImpressionsByPublication, publications, spotlight };
}

/**
 * Brand/subject comparison — runs a batched msearch for multiple subjects
 * at once. For each subject: a summary query, a monthly+publication
 * breakdown query, a sentiment histogram (same bucket scheme as the
 * single-topic Sentiment Distribution chart, for visual consistency), and
 * two single-article lookups for the most positive and most negative
 * headline. Returns an array of subject data objects ready for
 * comparative charts.
 */
export async function fetchBrandComparison(brands, dateRange = {}, interval = "month") {
  const format = DATE_FORMAT_FOR_INTERVAL[interval] || "yyyy-MM";
  const ndjsonLines = [];
  const headlineFields = ["title", "publication", "sentiment_score"];

  for (const brand of brands) {
    // summary query
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 0,
      query: topicFilter(brand, dateRange),
      aggs: {
        avg_sentiment: { avg: { field: "sentiment_score" } },
        total_impressions: { sum: { field: "estimated_impressions" } },
        total_emv: { sum: { field: "emv" } },
        avg_engagement: { avg: { field: "engagement_rate" } },
        avg_roi: { avg: { field: "roi_index" } },
      },
    }));
    // monthly + publication breakdown query
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 0,
      query: topicFilter(brand, dateRange),
      aggs: {
        monthly: {
          date_histogram: { field: "date", calendar_interval: interval, format },
          aggs: { avg_sentiment: { avg: { field: "sentiment_score" } } },
        },
        by_publication: { terms: { field: "publication", size: 30 } },
      },
    }));
    // sentiment distribution — same bucket scheme as the single-topic chart
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 0,
      query: topicFilter(brand, dateRange),
      aggs: {
        sentiment_histogram: {
          histogram: { field: "sentiment_score", interval: 0.2, extended_bounds: { min: -1, max: 0.8 } },
        },
      },
    }));
    // most positive headline
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 1, query: topicFilter(brand, dateRange), sort: [{ sentiment_score: { order: "desc" } }], _source: headlineFields,
    }));
    // most negative headline
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 1, query: topicFilter(brand, dateRange), sort: [{ sentiment_score: { order: "asc" } }], _source: headlineFields,
    }));
  }

  const result = await runMsearch(ndjsonLines);
  const brandData = [];
  const QUERIES_PER_BRAND = 5;

  for (let i = 0; i < brands.length; i++) {
    const base = i * QUERIES_PER_BRAND;
    const summaryResp = result.responses[base];
    const detailResp = result.responses[base + 1];
    const histResp = result.responses[base + 2];
    const topHeadlineResp = result.responses[base + 3];
    const bottomHeadlineResp = result.responses[base + 4];
    const aggs = summaryResp.aggregations;

    const monthly = {};
    for (const b of detailResp.aggregations.monthly.buckets) {
      monthly[b.key_as_string] = { count: b.doc_count, sentiment: b.avg_sentiment.value ?? 0 };
    }

    const publications = {};
    for (const b of detailResp.aggregations.by_publication.buckets) {
      publications[b.key] = b.doc_count;
    }

    const sentimentHistogram = (histResp.aggregations?.sentiment_histogram?.buckets || [])
      .map((b) => ({ bucketStart: b.key, count: b.doc_count }));

    brandData.push({
      brand: brands[i],
      volume: summaryResp.hits.total.value,
      sentiment: aggs.avg_sentiment.value ?? 0,
      impressions: aggs.total_impressions.value ?? 0,
      emv: aggs.total_emv.value ?? 0,
      engagement: aggs.avg_engagement.value ?? 0,
      roi: aggs.avg_roi.value ?? 0,
      monthly,
      publications,
      sentimentHistogram,
      topHeadline: topHeadlineResp.hits.hits[0]?._source || null,
      bottomHeadline: bottomHeadlineResp.hits.hits[0]?._source || null,
    });
  }

  return brandData;
}

/**
 * Related themes per subject — the single words most distinctively
 * associated with each subject's coverage, so subjects with similar KPI
 * numbers can still be told apart by what they're actually about. Uses
 * single-word significant_text only (not multi-word shingle fields),
 * which past testing showed is fast and reliable, unlike the multi-word
 * version that had to be removed from Best & Worst for timing out.
 */
export async function fetchBrandThemes(brands, dateRange = {}, size = 8) {
  const ndjsonLines = [];
  for (const brand of brands) {
    ndjsonLines.push(JSON.stringify({ index: INDEX }));
    ndjsonLines.push(JSON.stringify({
      size: 0,
      query: topicFilter(brand, dateRange),
      aggs: {
        themes: { significant_text: { field: "article", size: size + 5, exclude: [brand.toLowerCase()] } },
      },
    }));
  }
  const result = await runMsearch(ndjsonLines);
  return brands.map((brand, i) => {
    const buckets = result.responses[i].aggregations?.themes?.buckets || [];
    const words = buckets.map((b) => b.key).filter((k) => !containsStopword(k)).slice(0, size);
    return { brand, themes: words };
  });
}

