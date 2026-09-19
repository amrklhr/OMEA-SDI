import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ScatterChart, Scatter, ZAxis, AreaChart, Area, ComposedChart,
} from "recharts";
import {
  Newspaper, TrendingUp, Eye, MousePointerClick, DollarSign, Target, Smile, ChevronDown, ChevronUp, Search, Loader2, Trophy, TrendingDown, Download, Link2, Check, List, MessageCircle, AlertTriangle, Plus, X, Lightbulb, ArrowUp, ArrowDown,
} from "lucide-react";
import {
  fetchTopicData, fetchKeywordProminence, fetchContextBreakdown,
  fetchSentimentDistribution, fetchArticleSample,
  fetchArticlesForKeyword, fetchArticlesForSection,
  fetchMonthlyKpiBreakdown, fetchBrandComparison, fetchPriorPeriodSummary,
  fetchTopicTitleRankings, fetchBrandThemes, fetchAllTopicArticles,
} from "./opensearchClient";

const INK = "#1B2430";
const PAPER = "#EFEAE0";
const GOLD = "#C89B3C";
const POS = "#2E7D6B";
const NEG = "#B2434A";
const SUBTEXT = "#5B6472";

// Consistent, muted qualitative palette for publications — shared across the
// pie chart and stacked bar chart so the same outlet always reads as the
// same color throughout the dashboard (a Jakob's Law consistency cue).
const PUB_COLORS = {
  "Vox": "#C89B3C",
  "Vice": "#6B8F71",
  "Reuters": "#3B5B77",
  "Business Insider": "#8C6239",
  "Vice News": "#A45C6B",
  "Hyperallergic": "#7B6E8C",
  "TMZ": "#4A4038",
};
const FALLBACK_PALETTE = ["#5B6472", "#9C8F6E", "#6E8C88", "#8C6E7B"];
const BRAND_COLORS = ["#3B5B77", "#C89B3C", "#6B8F71", "#A45C6B", "#8C6239"];
function colorFor(name, index) {
  return PUB_COLORS[name] || FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

/** Builds the sorted union of period keys present across selected series. */
function combinedMonths(monthlyByPublication, selectedPubs) {
  const allMonths = new Set();
  for (const pubName of selectedPubs) {
    const series = monthlyByPublication[pubName] || {};
    Object.keys(series).forEach((m) => allMonths.add(m));
  }
  return [...allMonths].sort();
}

function fmtPct(v) { return `${(v * 100).toFixed(1)}%`; }
function fmtNum(v) { return Math.round(v).toLocaleString("en-US"); }
function fmtMoney(v) { return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }

/** Triggers a browser download of a CSV string. */
function downloadCSV(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPublicationTableCSV(topic, selectedPubs) {
  const filtered = topic.publications.filter((p) => selectedPubs.includes(p.name));
  const header = ["Publication", "Articles", "Sentiment", "Engagement Rate", "Impressions", "EMV", "CPE", "ROI Index"];
  const rows = filtered.map((p) => [
    p.name, p.articles, p.sentiment.toFixed(3), p.engagement, p.impressions, p.emv.toFixed(2), p.cpe.toFixed(2), p.roi,
  ]);
  downloadCSV(`omea_${topic.label}_publications.csv`, [header, ...rows]);
}

function exportKpiSummaryCSV(topic, selectedPubs) {
  const pubs = topic.publications.filter((p) => selectedPubs.includes(p.name));
  const volume = pubs.reduce((s, p) => s + p.articles, 0);
  const impressions = pubs.reduce((s, p) => s + p.impressions, 0);
  const emv = pubs.reduce((s, p) => s + p.emv, 0);
  const wAvg = (key) => (volume === 0 ? 0 : pubs.reduce((s, p) => s + p[key] * p.articles, 0) / volume);
  const rows = [
    ["KPI", "Value"],
    ["Topic", topic.label],
    ["Coverage Volume", volume],
    ["Avg. Sentiment", wAvg("sentiment").toFixed(3)],
    ["Est. Impressions", impressions],
    ["Engagement Rate", wAvg("engagement")],
    ["Avg. CTR", topic.summary.ctr],
    ["Earned Media Value", emv.toFixed(2)],
    ["ROI Index", wAvg("roi")],
  ];
  downloadCSV(`omea_${topic.label}_summary.csv`, rows);
}

/** Computes total, average, and median for a numeric array. */
function computeStats(values) {
  if (!values || values.length === 0) return { total: 0, avg: 0, median: 0 };
  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { total, avg, median };
}

function StatsRow({ items }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3" style={{ borderColor: "#E3DDCE" }}>
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <span className="text-xs" style={{ color: SUBTEXT }}>{it.label}:</span>
          <span className="font-mono text-sm" style={{ color: INK }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// Shared 1-4 word phrase length control — same rounded-pill style everywhere
// it appears (Content Insights, Best & Worst), so switching tabs doesn't
// mean re-learning a different control for the same concept.
function PhraseLengthControl({ value, onChange, label = "Phrase length:" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: SUBTEXT }}>{label}</span>
      {[1, 2, 3, 4].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          style={{
            borderColor: value === n ? INK : "#D9D2C2",
            background: value === n ? INK : "transparent",
            color: value === n ? PAPER : SUBTEXT,
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone, delta }) {
  const color = tone === "pos" ? POS : tone === "neg" ? NEG : INK;
  // delta is a percent change vs prior period — positive means up, negative means down
  const deltaColor = delta > 0 ? POS : delta < 0 ? NEG : SUBTEXT;
  return (
    <div className="flex flex-col gap-3 rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ color: SUBTEXT }}>
          <Icon size={16} strokeWidth={1.75} />
          <span className="text-xs tracking-wide">{label}</span>
        </div>
        {delta !== undefined && delta !== null && (
          <div className="flex items-center gap-0.5 text-xs font-medium" style={{ color: deltaColor }}>
            {delta > 0 ? <ArrowUp size={11} /> : delta < 0 ? <ArrowDown size={11} /> : null}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="font-mono text-3xl" style={{ color }}>{value}</div>
    </div>
  );
}

// generates data-driven recommendations from the current topic data
function generateInsights(topic, selectedPubs) {
  const insights = [];
  const pubs = topic.publications.filter((p) => selectedPubs.includes(p.name));
  if (pubs.length === 0) return insights;

  const volume = pubs.reduce((s, p) => s + p.articles, 0);
  const wAvg = (key) => (volume === 0 ? 0 : pubs.reduce((s, p) => s + p[key] * p.articles, 0) / volume);
  const sentiment = wAvg("sentiment");

  // top channel by coverage
  const topPub = [...pubs].sort((a, b) => b.articles - a.articles)[0];
  const topPubPct = ((topPub.articles / volume) * 100).toFixed(0);
  insights.push({
    type: "action",
    title: "Top coverage channel",
    text: `${topPub.name} accounts for ${topPubPct}% of all coverage (${topPub.articles} articles).`,
    recommendation: `Prioritize media outreach with ${topPub.name} for maximum visibility on this topic.`,
  });

  // most favorable outlet
  if (pubs.length > 1) {
    const bestSentPub = [...pubs].sort((a, b) => b.sentiment - a.sentiment)[0];
    if (bestSentPub.sentiment > 0.1) {
      insights.push({
        type: "positive",
        title: "Most favorable outlet",
        text: `${bestSentPub.name} has the highest sentiment (+${bestSentPub.sentiment.toFixed(2)}).`,
        recommendation: `Consider ${bestSentPub.name} for thought leadership pieces and positive brand placement.`,
      });
    }
  }

  // negative coverage risk
  if (pubs.length > 1) {
    const worstSentPub = [...pubs].sort((a, b) => a.sentiment - b.sentiment)[0];
    if (worstSentPub.sentiment < -0.1) {
      insights.push({
        type: "warning",
        title: "Negative coverage risk",
        text: `${worstSentPub.name} shows negative sentiment (${worstSentPub.sentiment.toFixed(2)}).`,
        recommendation: `Review recent ${worstSentPub.name} coverage and prepare response messaging if needed.`,
      });
    }
  }

  // overall narrative direction
  if (sentiment > 0.3) {
    insights.push({
      type: "positive",
      title: "Favorable media narrative",
      text: `Overall sentiment is +${sentiment.toFixed(2)} across ${volume} articles.`,
      recommendation: `Amplify positive coverage through owned channels and social media.`,
    });
  } else if (sentiment < 0) {
    insights.push({
      type: "warning",
      title: "Unfavorable media narrative",
      text: `Overall sentiment is ${sentiment.toFixed(2)} across ${volume} articles.`,
      recommendation: `Identify negative themes in Content Insights and develop counter-messaging.`,
    });
  }

  // highest engagement channel
  if (pubs.length > 1) {
    const bestEngPub = [...pubs].sort((a, b) => b.engagement - a.engagement)[0];
    insights.push({
      type: "action",
      title: "Highest audience engagement",
      text: `${bestEngPub.name} generates the highest engagement rate (${fmtPct(bestEngPub.engagement)}).`,
      recommendation: `Content through ${bestEngPub.name} is most likely to drive audience interaction.`,
    });
  }

  // coverage momentum (last vs previous period)
  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  if (sortedMonths.length >= 3) {
    const last = sortedMonths[sortedMonths.length - 1];
    const prev = sortedMonths[sortedMonths.length - 2];
    const lastVol = selectedPubs.reduce((s, p) => s + (topic.monthlyByPublication[p]?.[last] || 0), 0);
    const prevVol = selectedPubs.reduce((s, p) => s + (topic.monthlyByPublication[p]?.[prev] || 0), 0);
    if (prevVol > 0) {
      const change = ((lastVol - prevVol) / prevVol) * 100;
      if (change > 20) {
        insights.push({
          type: "positive",
          title: "Rising coverage momentum",
          text: `Coverage increased ${change.toFixed(0)}% from ${prev} to ${last}.`,
          recommendation: `Capitalize on rising interest by issuing new content while the topic is trending.`,
        });
      } else if (change < -30) {
        insights.push({
          type: "warning",
          title: "Declining coverage",
          text: `Coverage dropped ${Math.abs(change).toFixed(0)}% from ${prev} to ${last}.`,
          recommendation: `Consider a newsworthy angle or event to re-ignite media interest.`,
        });
      }
    }
  }

  return insights;
}

function InsightsPanel({ insights }) {
  if (!insights || insights.length === 0) return null;
  const iconFor = (type) => {
    if (type === "positive") return <TrendingUp size={14} style={{ color: POS }} />;
    if (type === "warning") return <AlertTriangle size={14} style={{ color: NEG }} />;
    return <Lightbulb size={14} style={{ color: GOLD }} />;
  };
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: GOLD, background: "#FBF7EE" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Actionable insights</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Data-driven recommendations for this topic and the selected channels.
      </div>
      <div className="flex flex-col gap-4">
        {insights.map((ins, i) => (
          <div key={i} className="flex gap-3">
            <div className="mt-0.5 shrink-0">{iconFor(ins.type)}</div>
            <div>
              <div className="text-sm font-medium" style={{ color: INK }}>{ins.title}</div>
              <div className="text-xs" style={{ color: "#3A4150" }}>{ins.text}</div>
              <div className="mt-1 text-xs font-medium" style={{ color: ins.type === "warning" ? NEG : POS }}>
                {ins.recommendation}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function detectSpikes(data) {
  if (data.length < 3) return new Set();
  const values = data.map((d) => d.v);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 1.5 * std;
  return new Set(data.filter((d) => d.v > threshold).map((d) => d.m));
}

const DATASET_START = "2016-01-01";
const DATASET_END = "2019-07-13";

const DATE_PRESETS = [
  { label: "All time", from: "", to: "" },
  { label: "2016", from: "2016-01-01", to: "2016-12-31" },
  { label: "2017", from: "2017-01-01", to: "2017-12-31" },
  { label: "2018", from: "2018-01-01", to: "2018-12-31" },
  { label: "2019", from: "2019-01-01", to: DATASET_END },
  { label: "Last 12 months", from: "2018-07-01", to: DATASET_END },
];

function TimeControls({ dateFrom, dateTo, onDateFromChange, onDateToChange, interval, onIntervalChange }) {
  const INTERVALS = [
    { id: "month", label: "Month" },
    { id: "quarter", label: "Quarter" },
    { id: "year", label: "Year" },
  ];
  const activePreset = DATE_PRESETS.find((p) => p.from === dateFrom && p.to === dateTo);
  function applyPreset(p) {
    onDateFromChange(p.from);
    onDateToChange(p.to);
  }
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs" style={{ color: SUBTEXT }}>Quick range:</span>
        {DATE_PRESETS.map((p) => {
          const active = activePreset?.label === p.label;
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: active ? INK : "#D9D2C2",
                background: active ? INK : "transparent",
                color: active ? PAPER : SUBTEXT,
              }}
            >
              {p.label}
            </button>
          );
        })}
        <span className="ml-1 text-xs italic" style={{ color: SUBTEXT }}>
          (dataset covers {DATASET_START} to {DATASET_END})
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: SUBTEXT }}>Custom: from</span>
          <input
            type="date"
            value={dateFrom}
            min={DATASET_START}
            max={DATASET_END}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: INK }}
          />
          <span className="text-xs" style={{ color: SUBTEXT }}>to</span>
          <input
            type="date"
            value={dateTo}
            min={DATASET_START}
            max={DATASET_END}
            onChange={(e) => onDateToChange(e.target.value)}
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: INK }}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { onDateFromChange(""); onDateToChange(""); }}
              className="text-xs underline"
              style={{ color: SUBTEXT }}
            >
              clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: SUBTEXT }}>Group by</span>
          <div className="flex rounded-sm border" style={{ borderColor: INK }}>
            {INTERVALS.map((iv) => (
              <button
                key={iv.id}
                onClick={() => onIntervalChange(iv.id)}
                className="px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: interval === iv.id ? INK : "transparent",
                  color: interval === iv.id ? PAPER : INK,
                }}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SpotlightCard({ spotlight }) {
  if (!spotlight || (!spotlight.top && !spotlight.bottom)) return null;
  const Item = ({ article, icon: Icon, label, tone }) => {
    if (!article) return null;
    const color = tone === "pos" ? POS : NEG;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2" style={{ color }}>
          <Icon size={15} />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          <span className="font-mono text-sm">{fmtPct(article.roi_index)} ROI</span>
        </div>
        <div className="text-sm font-medium" style={{ color: INK }}>{article.title}</div>
        <div className="text-xs" style={{ color: SUBTEXT }}>
          {article.publication} &middot; sentiment {(article.sentiment_score >= 0 ? "+" : "") + article.sentiment_score.toFixed(2)}
        </div>
      </div>
    );
  };
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Performance spotlight
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        The highest and lowest ROI Index articles for this topic and period.
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Item article={spotlight.top} icon={Trophy} label="Top performer" tone="pos" />
        <Item article={spotlight.bottom} icon={TrendingDown} label="Needs attention" tone="neg" />
      </div>
    </div>
  );
}

function MediaSharePie({ publications, selectedPubs }) {
  const data = publications
    .filter((p) => selectedPubs.includes(p.name))
    .map((p) => ({ name: p.name, value: p.articles }));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Total media share
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Share of total coverage volume by publication, for the selected channels.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorFor(d.name, i)} stroke={PAPER} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, n) => [`${v.toLocaleString()} articles (${((v / total) * 100).toFixed(1)}%)`, n]}
            contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: fmtNum(total) },
        { label: "Avg / publication", value: fmtNum(computeStats(data.map((d) => d.value)).avg) },
        { label: "Median / publication", value: fmtNum(computeStats(data.map((d) => d.value)).median) },
      ]} />
    </div>
  );
}

function ArticleListReveal({ expanded, loading, articles }) {
  if (!expanded) return null;
  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-sm border" style={{ borderColor: "#E3DDCE", background: "#F5F1E8" }}>
      {loading ? (
        <div className="flex items-center gap-2 p-3 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={13} className="animate-spin" /> Loading articles…
        </div>
      ) : articles.length === 0 ? (
        <div className="p-3 text-xs" style={{ color: SUBTEXT }}>No articles found.</div>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {articles.map((a, i) => (
              <tr key={i} className="border-b last:border-0" style={{ borderColor: "#E3DDCE" }}>
                <td className="px-3 py-2" style={{ color: INK }}>{a.title}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right" style={{ color: SUBTEXT }}>{a.publication}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function KeywordRow({ k, topic, dateRange, selectedPubs, onPivot }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState([]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && articles.length === 0) {
      setLoading(true);
      fetchArticlesForKeyword(topic, k.key, dateRange, selectedPubs)
        .then(setArticles)
        .catch(() => setArticles([]))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "#E3DDCE" }}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
          style={{ background: INK, color: PAPER }}
        >
          <List size={12} /> {k.key}
        </button>
        <button
          onClick={() => onPivot(k.key)}
          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors hover:opacity-80"
          style={{ borderColor: "#D9D2C2", color: SUBTEXT }}
          title="Search this keyword as a new topic"
        >
          <Search size={11} /> Search this keyword
        </button>
        <span className="text-xs" style={{ color: SUBTEXT }}>{k.docCount} articles</span>
      </div>
      {k.context && (
        <div className="pl-1 text-xs" style={{ color: "#3A4150" }}>
          <span className="font-medium" style={{ color: INK }}>{k.context.title}</span>
          {k.context.publication && <span style={{ color: SUBTEXT }}> — {k.context.publication}</span>}
          {k.context.snippet && (
            <div
              className="mt-1 italic"
              style={{ color: SUBTEXT }}
              dangerouslySetInnerHTML={{ __html: `\u201c${k.context.snippet}\u201d` }}
            />
          )}
        </div>
      )}
      <ArticleListReveal expanded={expanded} loading={loading} articles={articles} />
    </div>
  );
}

function KeywordPanel({ keywords, loading, phraseLength, onPhraseLengthChange, onPivot, topic, dateRange, selectedPubs }) {
  const LENGTHS = [
    { n: 1, label: "1 word" },
    { n: 2, label: "2 words" },
    { n: 3, label: "3 words" },
    { n: 4, label: "4 words" },
  ];
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="font-serif text-lg" style={{ color: INK }}>
          Related keywords
        </div>
        <PhraseLengthControl value={phraseLength} onChange={onPhraseLengthChange} />
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Terms or phrases that appear unusually often in this topic&apos;s coverage. Click a
        keyword to see its matching articles, or Analyze to search it as a new topic.
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading {LENGTHS.find((l) => l.n === phraseLength)?.label} phrases…
        </div>
      ) : keywords.length === 0 ? (
        <div className="py-4 text-xs" style={{ color: SUBTEXT }}>
          No significant {LENGTHS.find((l) => l.n === phraseLength)?.label} phrases found for this topic.
        </div>
      ) : (
        <KeywordList keywords={keywords} topic={topic} dateRange={dateRange} selectedPubs={selectedPubs} onPivot={onPivot} />
      )}
    </div>
  );
}

function KeywordList({ keywords, topic, dateRange, selectedPubs, onPivot }) {
  const INITIAL_SHOW = 5;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? keywords : keywords.slice(0, INITIAL_SHOW);
  const hasMore = keywords.length > INITIAL_SHOW;
  return (
    <div className="flex flex-col gap-3">
      {visible.map((k) => (
        <KeywordRow key={k.key} k={k} topic={topic} dateRange={dateRange} selectedPubs={selectedPubs} onPivot={onPivot} />
      ))}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="self-start rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "#FBFAF6" }}
        >
          {showAll ? `Show fewer` : `Show ${keywords.length - INITIAL_SHOW} more`}
        </button>
      )}
    </div>
  );
}

function ContextRow({ s, topic, dateRange, selectedPubs, totalMatched }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState([]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && articles.length === 0) {
      setLoading(true);
      fetchArticlesForSection(topic, s.name, dateRange, selectedPubs)
        .then(setArticles)
        .catch(() => setArticles([]))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "#E3DDCE" }}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
          style={{ background: INK, color: PAPER }}
        >
          <List size={12} /> {s.name}
        </button>
        <span className="text-xs" style={{ color: SUBTEXT }}>
          {s.count} articles ({((s.count / totalMatched) * 100).toFixed(0)}%)
        </span>
      </div>
      {s.context && (
        <div className="pl-1 text-xs" style={{ color: "#3A4150" }}>
          <span className="font-medium" style={{ color: INK }}>{s.context.title}</span>
          {s.context.publication && <span style={{ color: SUBTEXT }}> — {s.context.publication}</span>}
          {s.context.snippet && (
            <div
              className="mt-1 italic"
              style={{ color: SUBTEXT }}
              dangerouslySetInnerHTML={{ __html: `\u201c${s.context.snippet}\u201d` }}
            />
          )}
        </div>
      )}
      <ArticleListReveal expanded={expanded} loading={loading} articles={articles} />
    </div>
  );
}

function ContextPanel({ sections, loading, totalMatched, topic, dateRange, selectedPubs }) {
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Discussion contexts
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Which editorial sections this topic is covered in, based on each article&apos;s actual
        section metadata. Click a section to see its matching articles.
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading contexts…
        </div>
      ) : sections.length === 0 ? (
        <div className="py-4 text-xs" style={{ color: SUBTEXT }}>
          No section metadata available for this topic&apos;s articles.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map((s) => (
            <ContextRow key={s.name} s={s} topic={topic} dateRange={dateRange} selectedPubs={selectedPubs} totalMatched={totalMatched} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextTrendChart({ monthlyBySection, sections, totalMatched }) {
  if (!monthlyBySection || !sections || sections.length === 0) return null;
  const sectionNames = sections.map((s) => s.name);
  const sortedMonths = combinedMonths(monthlyBySection, sectionNames);
  const data = sortedMonths.map((m) => {
    const row = { m };
    sectionNames.forEach((name) => {
      row[name] = monthlyBySection[name]?.[m] || 0;
    });
    return row;
  });
  const periodTotals = data.map((row) => sectionNames.reduce((s, name) => s + row[name], 0));
  const stats = computeStats(periodTotals);

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Discussion contexts, monthly
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Absolute article volume per period, stacked by editorial section — shows both overall
        volume and which context is driving it, unlike a 100%-normalized view.
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(data.length / 8)} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
          <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {sectionNames.map((name, i) => (
            <Bar key={name} dataKey={name} stackId="context" fill={colorFor(name, i)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: fmtNum(totalMatched ?? stats.total) },
        { label: "Avg / period", value: stats.avg.toFixed(1) },
        { label: "Median / period", value: fmtNum(stats.median) },
      ]} />
    </div>
  );
}

function ContentInsightsView({ keywords, keywordsLoading, phraseLength, onPhraseLengthChange, contexts, contextsLoading, onPivotSearch, topic, dateRange, selectedPubs }) {
  return (
    <div className="flex flex-col gap-8">
      <ContextTrendChart monthlyBySection={contexts.monthlyBySection} sections={contexts.sections} totalMatched={contexts.totalMatched} />
      <ContextPanel
        sections={contexts.sections}
        loading={contextsLoading}
        totalMatched={contexts.totalMatched}
        topic={topic}
        dateRange={dateRange}
        selectedPubs={selectedPubs}
      />
      <KeywordPanel
        keywords={keywords}
        loading={keywordsLoading}
        phraseLength={phraseLength}
        onPhraseLengthChange={onPhraseLengthChange}
        onPivot={onPivotSearch}
        topic={topic}
        dateRange={dateRange}
        selectedPubs={selectedPubs}
      />
    </div>
  );
}

function BrandComparisonView({ dateRange, interval, initialSubject }) {
  const [brandInputs, setBrandInputs] = useState([initialSubject || "", ""]);
  const [brandData, setBrandData] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasCompared, setHasCompared] = useState(false);

  function updateBrand(idx, value) {
    const next = [...brandInputs];
    next[idx] = value;
    setBrandInputs(next);
  }
  function addBrand() {
    if (brandInputs.length < 5) setBrandInputs([...brandInputs, ""]);
  }
  function removeBrand(idx) {
    if (brandInputs.length > 2) setBrandInputs(brandInputs.filter((_, i) => i !== idx));
  }

  async function handleCompare(e) {
    e.preventDefault();
    const brands = brandInputs.map((b) => b.trim()).filter(Boolean);
    if (brands.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const [data, themeData] = await Promise.all([
        fetchBrandComparison(brands, dateRange, interval),
        fetchBrandThemes(brands, dateRange),
      ]);
      setBrandData(data);
      setThemes(themeData);
      setHasCompared(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // build coverage trend data for multi-line chart
  const allPeriods = new Set();
  brandData.forEach((b) => Object.keys(b.monthly).forEach((m) => allPeriods.add(m)));
  const sortedPeriods = [...allPeriods].sort();
  const trendData = sortedPeriods.map((m) => {
    const row = { period: m };
    brandData.forEach((b) => { row[b.brand] = b.monthly[m]?.count || 0; });
    return row;
  });

  // sentiment over time for multi-line
  const sentimentTrendData = sortedPeriods.map((m) => {
    const row = { period: m };
    brandData.forEach((b) => { row[b.brand] = b.monthly[m]?.sentiment ?? null; });
    return row;
  });

  const totalVolume = brandData.reduce((s, b) => s + b.volume, 0);

  return (
    <div className="flex flex-col gap-8">
      {/* brand input form */}
      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Compare subjects</div>
        <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
          Enter 2 to 5 subjects — brands, topics, or entities — to compare their media coverage side by side.
        </div>
        <form onSubmit={handleCompare} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {brandInputs.map((val, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <div className="h-3 w-3 rounded-full" style={{ background: BRAND_COLORS[idx] }} />
                <input
                  value={val}
                  onChange={(e) => updateBrand(idx, e.target.value)}
                  placeholder={`Subject ${idx + 1}`}
                  className="w-36 rounded-sm border px-2 py-1.5 text-sm outline-none"
                  style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: INK }}
                />
                {brandInputs.length > 2 && (
                  <button type="button" onClick={() => removeBrand(idx)} className="text-xs" style={{ color: SUBTEXT }}><X size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {brandInputs.length < 5 && (
              <button type="button" onClick={addBrand} className="flex items-center gap-1 text-xs font-medium" style={{ color: SUBTEXT }}>
                <Plus size={13} /> Add subject
              </button>
            )}
            <button
              type="submit"
              disabled={loading || brandInputs.filter((b) => b.trim()).length < 2}
              className="rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: INK, color: PAPER }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : "Compare"}
            </button>
          </div>
        </form>
        {error && <div className="mt-3 text-xs" style={{ color: NEG }}>{error}</div>}
      </div>

      {hasCompared && brandData.length > 0 && (
        <>
          {/* coverage trend overlay */}
          <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
            <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Coverage volume over time</div>
            <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
              Article count per period for each subject. Shows when coverage rises, falls, or spikes relative to competitors.
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(trendData.length / 8)} />
                <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
                <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {brandData.map((b, i) => (
                  <Line key={b.brand} type="monotone" dataKey={b.brand} stroke={BRAND_COLORS[i]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* share of voice bar */}
          <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
            <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Share of voice</div>
            <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
              Relative coverage volume across the compared subjects. Who dominates the media conversation.
            </div>
            <ResponsiveContainer width="100%" height={Math.max(120, brandData.length * 50)}>
              <BarChart data={brandData.map((b) => ({ name: b.brand, volume: b.volume }))} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: SUBTEXT }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: INK }} width={120} />
                <Tooltip formatter={(v) => [fmtNum(v), "Articles"]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
                <Bar dataKey="volume">
                  {brandData.map((b, i) => <Cell key={b.brand} fill={BRAND_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <StatsRow items={brandData.map((b) => ({
              label: b.brand,
              value: `${fmtNum(b.volume)} (${totalVolume > 0 ? ((b.volume / totalVolume) * 100).toFixed(1) : 0}%)`,
            }))} />
          </div>

          {/* publication mix comparison */}
          <PublicationMixChart brandData={brandData} />
          {/* impressions comparison */}
          <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
            <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Impressions comparison</div>
            <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
              Total estimated impressions per subject. Higher reach doesn't necessarily mean better
              received coverage — compare against sentiment below.
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={brandData.map((b) => ({ name: b.brand, impressions: b.impressions }))} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} />
                <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                <Tooltip formatter={(v) => [fmtNum(v), "Impressions"]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
                <Bar dataKey="impressions">
                  {brandData.map((b, i) => <Cell key={b.brand} fill={BRAND_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* sentiment comparison */}
          <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
            <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment comparison</div>
            <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
              Average sentiment per subject. Positive values indicate favorable coverage, negative values indicate critical coverage.
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={brandData.map((b) => ({ name: b.brand, sentiment: b.sentiment }))} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} />
                <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} domain={[-1, 1]} />
                <Tooltip formatter={(v) => [(v >= 0 ? "+" : "") + v.toFixed(3), "Sentiment"]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
                <Bar dataKey="sentiment">
                  {brandData.map((b, i) => <Cell key={b.brand} fill={b.sentiment >= 0 ? POS : NEG} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* sentiment distribution comparison */}
          <SentimentDistributionComparison brandData={brandData} />

          {/* sentiment trend over time */}
          <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
            <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment trend over time</div>
            <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
              How each subject's media sentiment evolves period by period.
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={sentimentTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(sentimentTrendData.length / 8)} />
                <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} domain={[-1, 1]} />
                <Tooltip formatter={(v) => [v !== null ? (v >= 0 ? "+" : "") + v.toFixed(3) : "n/a", "Sentiment"]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {brandData.map((b, i) => (
                  <Line key={b.brand} type="monotone" dataKey={b.brand} stroke={BRAND_COLORS[i]} strokeWidth={2} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* sample headlines */}
          <SampleHeadlinesPanel brandData={brandData} />

          {/* related themes */}
          <RelatedThemesPanel themes={themes} />

          {/* summary table */}
          <div className="overflow-x-auto rounded-sm border" style={{ borderColor: "#D9D2C2" }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ background: INK }}>
                  {["Subject", "Articles", "Sentiment", "Impressions", "EMV", "Engagement", "ROI Index"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-medium" style={{ color: PAPER, textAlign: h === "Subject" ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brandData.map((b, i) => (
                  <tr key={b.brand} className="border-b" style={{ borderColor: "#E3DDCE", background: "#FBFAF6" }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: INK }}>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: BRAND_COLORS[i] }} />
                      {b.brand}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: INK }}>{fmtNum(b.volume)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: b.sentiment >= 0 ? POS : NEG }}>{(b.sentiment >= 0 ? "+" : "") + b.sentiment.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: INK }}>{fmtNum(b.impressions)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: INK }}>{fmtMoney(b.emv)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: INK }}>{fmtPct(b.engagement)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: b.roi >= 0 ? POS : NEG }}>{fmtPct(b.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hasCompared && brandData.length === 0 && !loading && (
        <div className="rounded-sm border px-4 py-6 text-sm" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: SUBTEXT }}>
          No data found for the selected subjects. Try different names or widen the date range.
        </div>
      )}

      {hasCompared && brandData.length > 1 && (
        <BrandInsightsPanel brandData={brandData} totalVolume={totalVolume} />
      )}
    </div>
  );
}

function PublicationMixChart({ brandData }) {
  // union of every publication that appears for any compared subject
  const allPubs = [...new Set(brandData.flatMap((b) => Object.keys(b.publications)))];
  const chartData = allPubs.map((pub) => {
    const row = { publication: pub };
    brandData.forEach((b) => { row[b.brand] = b.publications[pub] || 0; });
    return row;
  });
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Publication mix</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Which outlets drive each subject's coverage. Two subjects can share the same average sentiment
        while being covered by completely different publications — this is where that difference shows up.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(160, allPubs.length * 32)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: SUBTEXT }} />
          <YAxis type="category" dataKey="publication" tick={{ fontSize: 11, fill: INK }} width={120} />
          <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {brandData.map((b, i) => (
            <Bar key={b.brand} dataKey={b.brand} fill={BRAND_COLORS[i]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SentimentDistributionComparison({ brandData }) {
  // same bucket labels as the single-topic Sentiment Distribution chart, for visual consistency
  const bucketLabels = ["-1.0 to -0.8", "-0.8 to -0.6", "-0.6 to -0.4", "-0.4 to -0.2", "-0.2 to 0.0", "0.0 to 0.2", "0.2 to 0.4", "0.4 to 0.6", "0.6 to 0.8", "0.8 to 1.2"];
  const bucketStarts = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8];
  const chartData = bucketLabels.map((label, i) => {
    const row = { bucket: label };
    brandData.forEach((b) => {
      const match = b.sentimentHistogram.find((h) => Math.abs(h.bucketStart - bucketStarts[i]) < 0.01);
      row[b.brand] = match ? match.count : 0;
    });
    return row;
  });
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment distribution comparison</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        How sentiment is actually spread out, not just the average. Two subjects can share the same
        average sentiment while one is uniformly mild and the other is polarized between strongly
        positive and strongly negative coverage.
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: SUBTEXT }} angle={-35} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {brandData.map((b, i) => (
            <Bar key={b.brand} dataKey={b.brand} fill={BRAND_COLORS[i]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SampleHeadlinesPanel({ brandData }) {
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sample headlines</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        The most positive and most negative article for each subject — a feel for the actual coverage, not just a score.
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {brandData.map((b, i) => (
          <div key={b.brand} className="rounded-sm border p-3" style={{ borderColor: "#E3DDCE" }}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: INK }}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BRAND_COLORS[i] }} />
              {b.brand}
            </div>
            {b.topHeadline ? (
              <div className="mb-2 text-xs">
                <div className="font-medium" style={{ color: POS }}>Most positive ({(b.topHeadline.sentiment_score >= 0 ? "+" : "") + b.topHeadline.sentiment_score.toFixed(2)})</div>
                <div style={{ color: INK }}>{b.topHeadline.title}</div>
                <div style={{ color: SUBTEXT }}>{b.topHeadline.publication}</div>
              </div>
            ) : null}
            {b.bottomHeadline ? (
              <div className="text-xs">
                <div className="font-medium" style={{ color: NEG }}>Most negative ({(b.bottomHeadline.sentiment_score >= 0 ? "+" : "") + b.bottomHeadline.sentiment_score.toFixed(2)})</div>
                <div style={{ color: INK }}>{b.bottomHeadline.title}</div>
                <div style={{ color: SUBTEXT }}>{b.bottomHeadline.publication}</div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatedThemesPanel({ themes }) {
  if (!themes || themes.length === 0) return null;
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Related themes</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        The words most distinctively associated with each subject's coverage (same significant_text
        method as Related Keywords in Content Insights). Subjects with similar KPI numbers can still
        be covering very different things.
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {themes.map((t, i) => (
          <div key={t.brand}>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium" style={{ color: INK }}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BRAND_COLORS[i] }} />
              {t.brand}
            </div>
            {t.themes.length === 0 ? (
              <div className="text-xs" style={{ color: SUBTEXT }}>No distinctive themes found.</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {t.themes.map((word) => (
                  <span key={word} className="rounded-full px-2 py-0.5 text-xs" style={{ background: "#F5F1E8", color: "#3A4150" }}>
                    {word}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function BrandInsightsPanel({ brandData, totalVolume }) {
  const sorted = [...brandData].sort((a, b) => b.volume - a.volume);
  const leader = sorted[0];
  const bestSentiment = [...brandData].sort((a, b) => b.sentiment - a.sentiment)[0];
  const worstSentiment = [...brandData].sort((a, b) => a.sentiment - b.sentiment)[0];
  const bestRoi = [...brandData].sort((a, b) => b.roi - a.roi)[0];

  const insights = [
    {
      type: "action",
      title: "Share of voice leader",
      text: `${leader.brand} dominates with ${fmtNum(leader.volume)} articles — ${totalVolume > 0 ? ((leader.volume / totalVolume) * 100).toFixed(0) : 0}% of total coverage across all compared subjects.`,
      recommendation: `Monitor ${leader.brand} closely as the benchmark. Closing the gap requires consistent outreach and newsworthy angles.`,
    },
    {
      type: bestSentiment.sentiment > 0 ? "positive" : "warning",
      title: "Most favorable coverage",
      text: `${bestSentiment.brand} has the highest average sentiment (${(bestSentiment.sentiment >= 0 ? "+" : "") + bestSentiment.sentiment.toFixed(2)}).`,
      recommendation: `Study ${bestSentiment.brand}'s messaging and media relationships — they are generating more favorable coverage than competitors.`,
    },
  ];

  if (worstSentiment.sentiment < -0.05 && worstSentiment.brand !== bestSentiment.brand) {
    insights.push({
      type: "warning",
      title: "Reputation risk",
      text: `${worstSentiment.brand} has the lowest sentiment (${(worstSentiment.sentiment >= 0 ? "+" : "") + worstSentiment.sentiment.toFixed(2)}).`,
      recommendation: `If this is a subject you are tracking closely, prioritize positive story placement and proactive media engagement to shift the narrative.`,
    });
  }

  insights.push({
    type: "action",
    title: "Most efficient media presence",
    text: `${bestRoi.brand} achieves the best ROI Index (${fmtPct(bestRoi.roi)}), meaning their coverage generates the most earned value per impression.`,
    recommendation: `Analyze the content type and publication mix that ${bestRoi.brand} uses to replicate their efficiency.`,
  });

  // publication concentration: which subject's coverage is most dependent on a single outlet
  const concentration = brandData.map((b) => {
    const counts = Object.values(b.publications);
    const total = counts.reduce((s, c) => s + c, 0);
    const topCount = counts.length > 0 ? Math.max(...counts) : 0;
    return { brand: b.brand, share: total > 0 ? topCount / total : 0, topPub: Object.entries(b.publications).sort((x, y) => y[1] - x[1])[0]?.[0] };
  });
  const mostConcentrated = [...concentration].sort((a, b) => b.share - a.share)[0];
  if (mostConcentrated && mostConcentrated.share > 0.5) {
    insights.push({
      type: "warning",
      title: "Concentrated coverage",
      text: `${(mostConcentrated.share * 100).toFixed(0)}% of ${mostConcentrated.brand}'s coverage comes from a single outlet (${mostConcentrated.topPub}).`,
      recommendation: `Diversifying media relationships beyond ${mostConcentrated.topPub} would reduce dependency on one publication's editorial stance.`,
    });
  }

  // sentiment volatility: which subject has the most spread-out (polarized) sentiment distribution
  const volatility = brandData.map((b) => {
    const total = b.sentimentHistogram.reduce((s, h) => s + h.count, 0);
    if (total === 0) return { brand: b.brand, spread: 0 };
    // share of articles in the two extreme buckets (strongly negative or strongly positive)
    const extremeCount = b.sentimentHistogram
      .filter((h) => h.bucketStart <= -0.6 || h.bucketStart >= 0.6)
      .reduce((s, h) => s + h.count, 0);
    return { brand: b.brand, spread: extremeCount / total };
  });
  const mostPolarized = [...volatility].sort((a, b) => b.spread - a.spread)[0];
  if (mostPolarized && mostPolarized.spread > 0.3) {
    insights.push({
      type: "warning",
      title: "Polarized coverage",
      text: `${(mostPolarized.spread * 100).toFixed(0)}% of ${mostPolarized.brand}'s coverage falls at a sentiment extreme (strongly positive or strongly negative), rather than neutral.`,
      recommendation: `Check Sample Headlines and Sentiment Distribution above to see what's driving the extremes — this pattern often means a single controversial event dominates the coverage.`,
    });
  }

  const iconFor = (type) => {
    if (type === "positive") return <TrendingUp size={14} style={{ color: POS }} />;
    if (type === "warning") return <AlertTriangle size={14} style={{ color: NEG }} />;
    return <Lightbulb size={14} style={{ color: GOLD }} />;
  };

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: GOLD, background: "#FBF7EE" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Competitive insights</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Data-driven observations from the brand comparison.
      </div>
      <div className="flex flex-col gap-4">
        {insights.map((ins, i) => (
          <div key={i} className="flex gap-3">
            <div className="mt-0.5 shrink-0">{iconFor(ins.type)}</div>
            <div>
              <div className="text-sm font-medium" style={{ color: INK }}>{ins.title}</div>
              <div className="text-xs" style={{ color: "#3A4150" }}>{ins.text}</div>
              <div className="mt-1 text-xs font-medium" style={{ color: ins.type === "warning" ? NEG : POS }}>{ins.recommendation}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TitleRankingsView({ topic, dateRange, selectedPubs }) {
  const [metric, setMetric] = useState("sentiment"); // sentiment | impressions | engagement
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    if (!topic?.label) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTopicTitleRankings(topic.label, dateRange, selectedPubs, metric, 20)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, dateRange.from, dateRange.to, selectedPubs, metric]);

  async function handleExportAll() {
    if (!topic?.label) return;
    setExporting(true);
    setExportError(null);
    try {
      const result = await fetchAllTopicArticles(topic.label, dateRange, selectedPubs);
      const header = ["Title", "Publisher", "Publish Date", "Sentiment", "Impressions", "EMV", "Engagement Rate"];
      const rows = result.articles.map((a) => [
        a.title,
        a.publication,
        a.date,
        (a.sentiment_score ?? 0).toFixed(3),
        Math.round(a.estimated_impressions || 0),
        (a.emv ?? 0).toFixed(2),
        (a.engagement_rate ?? 0).toFixed(4),
      ]);
      downloadCSV(`omea_${topic.label}_all_articles.csv`, [header, ...rows]);
      if (result.totalMatched > result.articles.length) {
        setExportError(`Exported the first ${fmtNum(result.articles.length)} of ${fmtNum(result.totalMatched)} matching articles (export cap reached). Narrow the date range to get the rest.`);
      }
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function formatMetric(article) {
    if (metric === "impressions") return fmtNum(Math.round(article.estimated_impressions || 0));
    if (metric === "engagement") return fmtPct(article.engagement_rate || 0);
    const v = article.sentiment_score || 0;
    return (v >= 0 ? "+" : "") + v.toFixed(2);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <div className="font-serif text-lg" style={{ color: INK }}>Best &amp; worst performing titles</div>
          <button
            onClick={handleExportAll}
            disabled={exporting || !topic?.label}
            className="flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "#FBFAF6" }}
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? "Exporting…" : "Export all matching articles (CSV)"}
          </button>
        </div>
        <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
          The top 20 and bottom 20 articles matching{" "}
          <span className="font-mono">{topic?.label}</span> for the selected date range, ranked by
          sentiment, impressions, or engagement. Real per-article values — no keyword mining involved.
          The export button pulls every matching article, not just the 40 shown below.
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: SUBTEXT }}>Rank by:</span>
          {[
            { id: "sentiment", label: "Sentiment" },
            { id: "impressions", label: "Impressions" },
            { id: "engagement", label: "Engagement" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: metric === m.id ? GOLD : "#D9D2C2",
                background: metric === m.id ? "#FBF7EE" : "transparent",
                color: metric === m.id ? INK : SUBTEXT,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {exportError && (
        <div className="rounded-sm border px-4 py-3 text-xs" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: NEG }}>
          {exportError}
        </div>
      )}

      {error && (
        <div className="rounded-sm border px-4 py-3 text-xs" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: NEG }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-sm border py-10 text-sm" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: SUBTEXT }}>
          <Loader2 size={16} className="animate-spin" /> Loading titles…
        </div>
      ) : !data || data.totalMatched === 0 ? (
        <div className="rounded-sm border px-4 py-6 text-sm" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: SUBTEXT }}>
          No articles found for this topic and date range.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <TitleRankingTable title="Top 20" articles={data.top} formatMetric={formatMetric} tone="pos" />
          <TitleRankingTable title="Bottom 20" articles={data.bottom} formatMetric={formatMetric} tone="neg" />
        </div>
      )}
    </div>
  );
}

function TitleRankingTable({ title, articles, formatMetric, tone }) {
  const metricColor = tone === "pos" ? POS : NEG;
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-3 flex items-center gap-2 font-serif text-lg" style={{ color: INK }}>
        {tone === "pos" ? <Trophy size={16} style={{ color: GOLD }} /> : <TrendingDown size={16} style={{ color: NEG }} />}
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {articles.map((a, i) => (
          <div key={i} className="flex items-start justify-between gap-3 border-b py-2 last:border-0" style={{ borderColor: "#E3DDCE" }}>
            <div className="text-sm" style={{ color: INK }}>
              {a.title}
              <div className="mt-0.5 text-xs" style={{ color: SUBTEXT }}>{a.publication} &middot; {a.date}</div>
            </div>
            <div className="whitespace-nowrap font-mono text-sm font-medium" style={{ color: metricColor }}>
              {formatMetric(a)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueChart({ monthlyEmvByPublication, selectedPubs }) {
  const sortedMonths = combinedMonths(monthlyEmvByPublication, selectedPubs);
  const chartData = sortedMonths.map((m) => ({
    m,
    emv: selectedPubs.reduce((sum, pubName) => sum + (monthlyEmvByPublication[pubName]?.[m] || 0), 0),
  }));
  const total = chartData.reduce((s, d) => s + d.emv, 0);

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Revenue generated (Earned Media Value)
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Total EMV per period for the selected channels — ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} over the current range.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(chartData.length / 8)} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
          <Tooltip
            formatter={(v) => [`$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "EMV"]}
            contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }}
          />
          <Bar dataKey="emv" fill={POS} />
        </BarChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: fmtMoney(total) },
        { label: "Avg / period", value: fmtMoney(computeStats(chartData.map((d) => d.emv)).avg) },
        { label: "Median / period", value: fmtMoney(computeStats(chartData.map((d) => d.emv)).median) },
      ]} />
    </div>
  );
}

function MarketingOwnerView({ topic, selectedPubs, priorSummary, dateTo }) {
  const pubs = topic.publications.filter((p) => selectedPubs.includes(p.name));
  const volume = pubs.reduce((sum, p) => sum + p.articles, 0);
  const impressions = pubs.reduce((sum, p) => sum + p.impressions, 0);
  const emv = pubs.reduce((sum, p) => sum + p.emv, 0);
  const wAvg = (key) => (volume === 0 ? 0 : pubs.reduce((sum, p) => sum + p[key] * p.articles, 0) / volume);
  const sentiment = wAvg("sentiment");
  const engagement = wAvg("engagement");
  const roi = wAvg("roi");
  const isFiltered = selectedPubs.length < topic.publications.length;

  // compute % change vs prior period for each KPI
  const pct = (curr, prev) => (prev && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null);
  const d = priorSummary ? {
    volume:     pct(volume,     priorSummary.volume),
    sentiment:  pct(sentiment,  priorSummary.sentiment),
    impressions:pct(impressions,priorSummary.impressions),
    engagement: pct(engagement, priorSummary.engagement),
    emv:        pct(emv,        priorSummary.emv),
    roi:        pct(roi,        priorSummary.roi),
  } : {};

  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  const chartData = sortedMonths.map((m) => ({
    m,
    v: selectedPubs.reduce((sum, pubName) => sum + (topic.monthlyByPublication[pubName]?.[m] || 0), 0),
    impressions: selectedPubs.reduce((sum, pubName) => sum + (topic.monthlyImpressionsByPublication?.[pubName]?.[m] || 0), 0),
  }));
  const spikes = detectSpikes(chartData);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: SUBTEXT, letterSpacing: "0.08em" }}>Effectiveness</div>
          <button
            onClick={() => exportKpiSummaryCSV(topic, selectedPubs)}
            className="flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "#FBFAF6" }}
          >
            <Download size={13} /> Export summary CSV
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard icon={Newspaper} label="Coverage Volume" value={fmtNum(volume)} delta={d.volume} />
          <KpiCard icon={Smile} label="Avg. Sentiment" value={(sentiment >= 0 ? "+" : "") + sentiment.toFixed(2)} tone={sentiment >= 0 ? "pos" : "neg"} delta={d.sentiment} />
          <KpiCard icon={Eye} label="Est. Impressions" value={`${(impressions / 1_000_000).toFixed(1)}M`} delta={d.impressions} />
          <KpiCard icon={TrendingUp} label="Engagement Rate" value={fmtPct(engagement)} delta={d.engagement} />
        </div>

        <div className="mt-1 text-xs font-medium uppercase tracking-wide" style={{ color: SUBTEXT, letterSpacing: "0.08em" }}>Efficiency</div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <KpiCard icon={MousePointerClick} label="Avg. CTR" value={fmtPct(topic.summary.ctr)} />
          <KpiCard icon={DollarSign} label="Earned Media Value" value={`$${(emv / 1000).toFixed(1)}K`} tone="pos" delta={d.emv} />
          <KpiCard icon={Target} label="ROI Index" value={fmtPct(roi)} tone={roi >= 0 ? "pos" : "neg"} delta={d.roi} />
        </div>
      </div>

      <SpotlightCard spotlight={topic.spotlight} />

      <MediaSharePie publications={topic.publications} selectedPubs={selectedPubs} />

      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
          Coverage volume &amp; impressions over time
        </div>
        <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
          Gray bars are article count (left axis); the line is estimated impressions (right axis) —
          shows whether rising coverage is actually translating into reach, or just more articles with
          the same audience.{" "}
          {isFiltered
            ? `Showing ${selectedPubs.length} of ${topic.publications.length} selected channels.`
            : "Live data from your OpenSearch index."}
          {spikes.size > 0 && (
            <span> Gold bars mark statistically detected coverage spikes (volume &gt; mean + 1.5&times;std dev): {[...spikes].join(", ")}.</span>
          )}
          {(dateTo === "" || dateTo >= "2019-06") && (
            <span style={{ color: NEG }}> Note: the June 2019 spike is a corpus-wide collection artifact, not a real coverage event.</span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#E3DDCE" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(chartData.length / 8)} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: SUBTEXT }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
            <Tooltip
              contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }}
              labelStyle={{ color: INK }}
              formatter={(value, name) => name === "Impressions" ? [fmtNum(value), name] : [value, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="v" name="Articles" radius={[2, 2, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.m} fill={spikes.has(entry.m) ? GOLD : "#8C8477"} fillOpacity={spikes.has(entry.m) ? 0.9 : 0.2} />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="impressions"
              stroke={INK}
              strokeWidth={2.5}
              dot={{ r: 3, fill: INK, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name="Impressions"
            />
          </ComposedChart>
        </ResponsiveContainer>
        <StatsRow items={[
          { label: "Total articles", value: fmtNum(computeStats(chartData.map((d) => d.v)).total) },
          { label: "Avg / period", value: computeStats(chartData.map((d) => d.v)).avg.toFixed(1) },
          { label: "Total impressions", value: fmtNum(computeStats(chartData.map((d) => d.impressions)).total) },
        ]} />
      </div>

      <RevenueChart monthlyEmvByPublication={topic.monthlyEmvByPublication} selectedPubs={selectedPubs} />

      <InsightsPanel insights={generateInsights(topic, selectedPubs)} />
    </div>
  );
}

function ExplainPanel({ pub }) {
  const baseline = pub.impressions * (15 / 1000);
  return (
    <tr>
      <td colSpan={8} className="border-b px-5 py-4" style={{ borderColor: "#E3DDCE", background: "#F5F1E8" }}>
        <div className="grid gap-4 font-mono text-xs md:grid-cols-2" style={{ color: "#3A4150" }}>
          <div>
            <div className="mb-1 font-sans font-medium" style={{ color: INK }}>Earned Media Value</div>
            impressions &times; $0.01 &times; (1 + sentiment)<br />
            = {fmtNum(pub.impressions)} &times; 0.01 &times; {(1 + pub.sentiment).toFixed(3)}<br />
            = {fmtMoney(pub.emv)}
          </div>
          <div>
            <div className="mb-1 font-sans font-medium" style={{ color: INK }}>ROI Index</div>
            (EMV &minus; paid-equivalent cost) / paid-equivalent cost<br />
            paid-equivalent cost = impressions &times; $15 CPM &divide; 1000 = {fmtMoney(baseline)}<br />
            = ({fmtMoney(pub.emv)} &minus; {fmtMoney(baseline)}) / {fmtMoney(baseline)} = {fmtPct(pub.roi)}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ShareOfVoiceStackedBar({ topic, selectedPubs }) {
  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  const data = sortedMonths.map((m) => {
    const row = { m };
    const total = selectedPubs.reduce((sum, p) => sum + (topic.monthlyByPublication[p]?.[m] || 0), 0);
    selectedPubs.forEach((p) => {
      const count = topic.monthlyByPublication[p]?.[m] || 0;
      row[p] = total > 0 ? (count / total) * 100 : 0;
    });
    return row;
  });

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
        Share of voice over time
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Each bar totals 100% — showing which publications drove coverage in a given period,
        not just how much coverage there was overall.
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(data.length / 8)} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
          <Tooltip
            formatter={(v, n) => [`${v.toFixed(1)}%`, n]}
            contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {selectedPubs.map((p, i) => (
            <Bar key={p} dataKey={p} stackId="share" fill={colorFor(p, i)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total articles", value: fmtNum(computeStats(topic.publications.filter((p) => selectedPubs.includes(p.name)).map((p) => p.articles)).total) },
        { label: "Avg / publication", value: fmtNum(computeStats(topic.publications.filter((p) => selectedPubs.includes(p.name)).map((p) => p.articles)).avg) },
        { label: "Median / publication", value: fmtNum(computeStats(topic.publications.filter((p) => selectedPubs.includes(p.name)).map((p) => p.articles)).median) },
      ]} />
    </div>
  );
}

function SentimentHistogram({ data, loading }) {
  const bars = data.map((d) => ({
    label: `${d.bucketStart.toFixed(1)} to ${(d.bucketStart + 0.2).toFixed(1)}`,
    mid: d.bucketStart + 0.1,
    count: d.count,
  }));
  const totalArticles = bars.reduce((s, b) => s + b.count, 0);
  const weightedAvgSentiment = totalArticles > 0
    ? bars.reduce((s, b) => s + b.mid * b.count, 0) / totalArticles
    : 0;
  // Approximate weighted median: the bucket where cumulative count crosses 50%.
  let cumulative = 0, medianBucketMid = 0;
  for (const b of bars) {
    cumulative += b.count;
    if (cumulative >= totalArticles / 2) { medianBucketMid = b.mid; break; }
  }
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment distribution</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        How article sentiment is actually spread out — a flat average can hide whether coverage is uniformly neutral or a mix of strong positive and negative.
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bars} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#E3DDCE" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: SUBTEXT }} />
            <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
            <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} formatter={(v) => [v, "Articles"]} />
            <Bar dataKey="count">
              {bars.map((b, i) => (
                <Cell key={i} fill={b.mid >= 0 ? POS : NEG} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {!loading && (
        <StatsRow items={[
          { label: "Total articles", value: fmtNum(totalArticles) },
          { label: "Avg sentiment", value: (weightedAvgSentiment >= 0 ? "+" : "") + weightedAvgSentiment.toFixed(2) },
          { label: "Median sentiment (approx.)", value: (medianBucketMid >= 0 ? "+" : "") + medianBucketMid.toFixed(2) },
        ]} />
      )}
    </div>
  );
}

function SentimentRoiScatter({ sample, selectedPubs, loading }) {
  const byPub = {};
  const allPoints = [];
  const articles = sample?.articles || [];
  articles.forEach((a) => {
    if (!selectedPubs.includes(a.publication)) return;
    (byPub[a.publication] = byPub[a.publication] || []).push({ x: a.sentiment_score, y: a.roi_index });
    allPoints.push(a.roi_index);
  });
  const stats = computeStats(allPoints);
  const totalMatched = sample?.totalMatched ?? allPoints.length;
  const isPartialSample = allPoints.length < totalMatched;
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment vs. ROI Index</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Each point is one article — makes the ROI formula's dependence on sentiment visually
        inspectable, colored by publication.
        {isPartialSample && (
          <span> Showing a sample of {fmtNum(allPoints.length)} of {fmtNum(totalMatched)} total matching articles (capped for chart performance).</span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading article sample…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#E3DDCE" />
            <XAxis type="number" dataKey="x" name="Sentiment" domain={[-1, 1]} tick={{ fontSize: 10, fill: SUBTEXT }} />
            <YAxis type="number" dataKey="y" name="ROI Index" tickFormatter={fmtPct} tick={{ fontSize: 10, fill: SUBTEXT }} />
            <ZAxis range={[25, 25]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} formatter={(v, n) => [n === "ROI" ? fmtPct(v) : v.toFixed(2), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {Object.entries(byPub).map(([pub, points], i) => (
              <Scatter key={pub} name={pub} data={points} fill={colorFor(pub, i)} fillOpacity={0.7} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {!loading && (
        <StatsRow items={[
          { label: isPartialSample ? `Sampled (of ${fmtNum(totalMatched)})` : "Articles (n)", value: fmtNum(allPoints.length) },
          { label: "Avg ROI", value: fmtPct(stats.avg) },
          { label: "Median ROI", value: fmtPct(stats.median) },
        ]} />
      )}
    </div>
  );
}

function CpeByPublicationChart({ publications, selectedPubs }) {
  const data = publications.filter((p) => selectedPubs.includes(p.name));
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Cost per Engagement by publication</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Which channels are most cost-efficient, not just highest-reach — lower is better.
        Note: CPE is formula-driven from engagement rate, so variance between publications is narrow by design.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: SUBTEXT }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
          <Tooltip formatter={(v) => [`$${v.toFixed(2)}`, "CPE"]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
          <Bar dataKey="cpe">
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorFor(d.name, i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: `$${computeStats(data.map((d) => d.cpe)).total.toFixed(2)}` },
        { label: "Avg", value: `$${computeStats(data.map((d) => d.cpe)).avg.toFixed(2)}` },
        { label: "Median", value: `$${computeStats(data.map((d) => d.cpe)).median.toFixed(2)}` },
      ]} />
    </div>
  );
}

function WordCountEngagementScatter({ sample, selectedPubs, loading }) {
  const byPub = {};
  const allEngagement = [];
  const articles = sample?.articles || [];
  articles.forEach((a) => {
    if (!selectedPubs.includes(a.publication)) return;
    (byPub[a.publication] = byPub[a.publication] || []).push({ x: a.word_count, y: a.engagement_rate });
    allEngagement.push(a.engagement_rate);
  });
  const stats = computeStats(allEngagement);
  const totalMatched = sample?.totalMatched ?? allEngagement.length;
  const isPartialSample = allEngagement.length < totalMatched;
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Article length vs. engagement</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Tests whether longer, more substantial articles about this topic actually perform differently.
        {isPartialSample && (
          <span> Showing a sample of {fmtNum(allEngagement.length)} of {fmtNum(totalMatched)} total matching articles (capped for chart performance).</span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading article sample…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#E3DDCE" />
            <XAxis type="number" dataKey="x" name="Word count" tick={{ fontSize: 10, fill: SUBTEXT }} />
            <YAxis type="number" dataKey="y" name="Engagement" tickFormatter={fmtPct} tick={{ fontSize: 10, fill: SUBTEXT }} />
            <ZAxis range={[25, 25]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} formatter={(v, n) => [n === "Engagement" ? fmtPct(v) : v, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {Object.entries(byPub).map(([pub, points], i) => (
              <Scatter key={pub} name={pub} data={points} fill={colorFor(pub, i)} fillOpacity={0.7} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {!loading && (
        <StatsRow items={[
          { label: isPartialSample ? `Sampled (of ${fmtNum(totalMatched)})` : "Articles (n)", value: fmtNum(allEngagement.length) },
          { label: "Avg engagement", value: fmtPct(stats.avg) },
          { label: "Median engagement", value: fmtPct(stats.median) },
        ]} />
      )}
    </div>
  );
}

function CoverageTrendBarChart({ topic, selectedPubs }) {
  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  const periodTotals = [];
  const data = sortedMonths.map((m) => {
    const periodTotal = selectedPubs.reduce((sum, p) => sum + (topic.monthlyByPublication[p]?.[m] || 0), 0);
    periodTotals.push(periodTotal);
    return { m, total: periodTotal };
  });
  const stats = computeStats(periodTotals);
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Coverage trend, total publications</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Total article volume per period, summed across all selected channels — shows
        period-to-period trend directly, not a running cumulative total.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(data.length / 8)} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
          <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} formatter={(v) => [fmtNum(v), "Articles"]} />
          <Bar dataKey="total" fill={GOLD} />
        </BarChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: fmtNum(stats.total) },
        { label: "Avg / period", value: stats.avg.toFixed(1) },
        { label: "Median / period", value: fmtNum(stats.median) },
      ]} />
    </div>
  );
}

const CLUSTER_KPIS = [
  { key: "volume", label: "Coverage Volume", fmt: fmtNum },
  { key: "sentiment", label: "Avg. Sentiment", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(2) },
  { key: "impressions", label: "Est. Impressions", fmt: fmtNum },
  { key: "engagement", label: "Engagement Rate", fmt: fmtPct },
  { key: "ctr", label: "Avg. CTR", fmt: fmtPct },
  { key: "emv", label: "Earned Media Value", fmt: fmtMoney },
  { key: "roi", label: "ROI Index", fmt: fmtPct },
];

function KpiClusteredChart({ kpiByPublication, selectedPubs, loading }) {
  const [selectedKpi, setSelectedKpi] = useState("volume");
  const kpiDef = CLUSTER_KPIS.find((k) => k.key === selectedKpi);

  // Slice the combined per-publication/per-period/per-KPI data down to just
  // the currently selected KPI, so switching KPIs is instant (no refetch).
  const sliced = {};
  for (const pub of selectedPubs) {
    sliced[pub] = {};
    const periods = kpiByPublication[pub] || {};
    for (const [period, values] of Object.entries(periods)) {
      sliced[pub][period] = values[selectedKpi];
    }
  }
  const sortedPeriods = combinedMonths(sliced, selectedPubs);
  const chartData = sortedPeriods.map((period) => {
    const row = { period };
    selectedPubs.forEach((pub) => { row[pub] = sliced[pub]?.[period] ?? 0; });
    return row;
  });

  const allValues = chartData.flatMap((row) => selectedPubs.map((p) => row[p]));
  const stats = computeStats(allValues);

  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="font-serif text-lg" style={{ color: INK }}>
          KPI comparison by channel
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CLUSTER_KPIS.map((k) => (
          <button
            key={k.key}
            onClick={() => setSelectedKpi(k.key)}
            className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: selectedKpi === k.key ? INK : "#D9D2C2",
              background: selectedKpi === k.key ? INK : "transparent",
              color: selectedKpi === k.key ? PAPER : SUBTEXT,
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        {kpiDef.label} per period, one bar per channel — compare which publications drove a
        metric in a given period, not just the combined total.
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs" style={{ color: SUBTEXT }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#E3DDCE" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(chartData.length / 8)} />
              <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} tickFormatter={kpiDef.fmt} />
              <Tooltip formatter={(v) => [kpiDef.fmt(v), kpiDef.label]} contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {selectedPubs.map((pub, i) => (
                <Bar key={pub} dataKey={pub} fill={colorFor(pub, i)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <StatsRow items={[
            { label: "Total", value: kpiDef.fmt(stats.total) },
            { label: "Avg", value: kpiDef.fmt(stats.avg) },
            { label: "Median", value: kpiDef.fmt(stats.median) },
          ]} />
        </>
      )}
    </div>
  );
}

function DataAnalystView({ topic, selectedPubs, sentimentDistribution, articleSample, analystExtrasLoading, kpiByPublication, kpiByPublicationLoading }) {
  const [sortKey, setSortKey] = useState("articles");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  const filtered = topic.publications.filter((p) => selectedPubs.includes(p.name));
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return a[sortKey] > b[sortKey] ? dir : a[sortKey] < b[sortKey] ? -dir : 0;
  });

  function toggleSort(key) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const columns = [
    { key: "name", label: "Publication", fmt: (v) => v, align: "left" },
    { key: "articles", label: "Articles", fmt: fmtNum },
    { key: "sentiment", label: "Sentiment", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(3) },
    { key: "engagement", label: "Engagement", fmt: fmtPct },
    { key: "impressions", label: "Impressions", fmt: fmtNum },
    { key: "emv", label: "EMV", fmt: fmtMoney },
    { key: "cpe", label: "CPE", fmt: (v) => `$${v.toFixed(2)}` },
    { key: "roi", label: "ROI Index", fmt: fmtPct },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs" style={{ color: SUBTEXT }}>
        <span>
          Filtered: topic = <span className="font-mono">{topic.label}</span>
          &middot; {filtered.length} publication{filtered.length !== 1 ? "s" : ""}, {fmtNum(filtered.reduce((s, p) => s + p.articles, 0))} articles.
          <span style={{ color: GOLD }}>&nbsp;&#9662; Click any row below to trace its formula.</span>
        </span>
        <button
          onClick={() => exportPublicationTableCSV(topic, selectedPubs)}
          className="flex shrink-0 items-center gap-1.5 rounded-sm border px-3 py-1.5 font-medium"
          style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "#FBFAF6" }}
        >
          <Download size={13} /> Export table CSV
        </button>
      </div>

      <ShareOfVoiceStackedBar topic={topic} selectedPubs={selectedPubs} />

      <KpiClusteredChart kpiByPublication={kpiByPublication} selectedPubs={selectedPubs} loading={kpiByPublicationLoading} />

      <div className="grid gap-8 md:grid-cols-2">
        <SentimentHistogram data={sentimentDistribution} loading={analystExtrasLoading} />
        <CpeByPublicationChart publications={topic.publications} selectedPubs={selectedPubs} />
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <SentimentRoiScatter sample={articleSample} selectedPubs={selectedPubs} loading={analystExtrasLoading} />
        <WordCountEngagementScatter sample={articleSample} selectedPubs={selectedPubs} loading={analystExtrasLoading} />
      </div>

      <CoverageTrendBarChart topic={topic} selectedPubs={selectedPubs} />

      <div className="overflow-x-auto rounded-sm border" style={{ borderColor: "#D9D2C2" }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ background: INK }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-sans text-xs font-medium"
                  style={{ color: PAPER, textAlign: c.align || "right" }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((pub) => (
              <>
                <tr
                  key={pub.name}
                  onClick={() => setExpanded(expanded === pub.name ? null : pub.name)}
                  className="cursor-pointer border-b transition-colors"
                  style={{ borderColor: "#E3DDCE", background: expanded === pub.name ? "#F5F1E8" : "#FBFAF6" }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="whitespace-nowrap px-4 py-3 font-mono text-sm"
                      style={{
                        textAlign: c.align || "right",
                        color: c.key === "roi" || c.key === "sentiment"
                          ? (pub[c.key] >= 0 ? POS : NEG)
                          : INK,
                        fontFamily: c.key === "name" ? "ui-sans-serif, system-ui" : undefined,
                      }}
                    >
                      {c.key === "name" && (
                        <span className="mr-1.5 inline-block" style={{ color: SUBTEXT }}>
                          {expanded === pub.name ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
                        </span>
                      )}
                      {c.fmt(pub[c.key])}
                    </td>
                  ))}
                </tr>
                {expanded === pub.name && <ExplainPanel key={pub.name + "-panel"} pub={pub} />}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublicationFilter({ allPubs, selected, onChange }) {
  function toggle(name) {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else onChange([...selected, name]);
  }
  const allSelected = selected.length === allPubs.length;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs" style={{ color: SUBTEXT }}>Channels:</span>
      <button
        onClick={() => onChange(allSelected ? [] : allPubs.map((p) => p.name))}
        className="rounded-full border px-3 py-1 text-xs font-medium"
        style={{
          borderColor: INK,
          background: allSelected ? INK : "transparent",
          color: allSelected ? PAPER : INK,
        }}
      >
        All
      </button>
      {allPubs.map((p) => {
        const active = selected.includes(p.name);
        return (
          <button
            key={p.name}
            onClick={() => toggle(p.name)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: active ? INK : "#D9D2C2",
              background: active ? INK : "transparent",
              color: active ? PAPER : SUBTEXT,
            }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(p.name, 0), opacity: active ? 1 : 0.5 }} />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/** Loads a single topic's full dataset, reacting to date range / interval changes. */
function useTopic(topicName, dateRange, interval) {
  const [topic, setTopic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!topicName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTopicData(topicName, dateRange, interval)
      .then((data) => { if (!cancelled) setTopic(data); })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.message.includes("Failed to fetch")
              ? "Could not connect to the data backend. If running locally, make sure Docker is running."
              : err.message
          );
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [topicName, dateRange.from, dateRange.to, interval]);

  return { topic, loading, error };
}

function FormulaCard({ title, formula, explanation }) {
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-2 font-serif text-base" style={{ color: INK }}>{title}</div>
      <div className="mb-3 rounded-sm p-3 font-mono text-xs" style={{ background: INK, color: GOLD }}>
        {formula}
      </div>
      <div className="text-xs" style={{ color: SUBTEXT }}>{explanation}</div>
    </div>
  );
}

function MethodologyView() {
  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-sm border p-5" style={{ borderColor: GOLD, background: "#FBF3DF" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Explainability principle</div>
        <div className="text-sm" style={{ color: "#3A4150" }}>
          Every number in this dashboard — real or synthetic — traces back to a documented,
          transparent formula. Nothing is a black-box model. Assumption constants (reach tiers,
          CPM, value-per-impression) are clearly labeled as modeling assumptions, not measured
          fact, so they can be inspected and challenged rather than blindly trusted.
        </div>
      </div>

      <div>
        <div className="mb-3 font-serif text-lg" style={{ color: INK }}>Effectiveness vs. efficiency</div>
        <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
          <p className="mb-3 text-sm" style={{ color: "#3A4150" }}>
            This dashboard distinguishes between two types of media performance metrics:
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium" style={{ color: INK }}>Effectiveness (did we achieve the goal?)</div>
              <p className="text-xs" style={{ color: "#3A4150" }}>
                Coverage Volume (reach), Share of Voice (awareness), Sentiment Score (perception
                quality), Keyword Prominence (message penetration), and Engagement Rate (audience
                response). These answer: <em>what was achieved</em> by the media presence.
              </p>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium" style={{ color: INK }}>Efficiency (at what cost per outcome?)</div>
              <p className="text-xs" style={{ color: "#3A4150" }}>
                Cost per Engagement (CPE), ROI Index, and Earned Media Value (EMV). These compare
                outcomes against resource costs and answer: <em>how efficiently</em> media value was
                generated relative to paid alternatives.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 font-serif text-lg" style={{ color: INK }}>Sentiment scoring</div>
        <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
          <p className="mb-3 text-sm" style={{ color: "#3A4150" }}>
            Sentiment is computed using <strong>VADER</strong>, a lexicon-based sentiment tool — it
            scores text by counting matches against a fixed, published list of positive and
            negative words and phrases, then combines them into a single score. This is
            deliberately <em>not</em> a trained machine-learning model: the word list is
            inspectable, and the same input text always produces the same score for a
            documented reason.
          </p>
          <div className="rounded-sm p-3 font-mono text-xs" style={{ background: INK, color: GOLD }}>
            sentiment_score = compound VADER score, ranging from -1 (very negative) to +1 (very positive)
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 font-serif text-lg" style={{ color: INK }}>Layer 1 — Real KPIs (OpenSearch aggregations)</div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormulaCard
            title="Coverage Volume"
            formula="count(articles) per period"
            explanation="A straight date_histogram aggregation — no per-article field needed."
          />
          <FormulaCard
            title="Share of Voice"
            formula="count(publication, topic) / count(publication, total)"
            explanation="What fraction of a publication's overall output covers this topic."
          />
        </div>
      </div>

      <div>
        <div className="mb-3 font-serif text-lg" style={{ color: INK }}>Layer 2 — Synthetic performance KPIs (formula-driven)</div>
        <div className="mb-4 rounded-sm border p-4 text-xs" style={{ borderColor: "#D9D2C2", background: "#F5F1E8", color: SUBTEXT }}>
          <strong style={{ color: INK }}>Assumption constants</strong> — documented, not measured: reach
          tier per publication (Reuters 10, Business Insider 8, TMZ 7, Vice 6, Vice News 6, Vox 6,
          Hyperallergic 3 — representing relative assumed audience size), section weight (News/
          Politics/Business = 1.5, Entertainment/Opinion = 1.2, other = 1.0), $0.01 assumed value
          per impression, and a $15 CPM (cost per 1,000 impressions) paid-media benchmark.
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormulaCard
            title="Estimated Impressions"
            formula="reach_tier × 1,000 × section_weight"
            explanation="Modeled audience reach based on the publication's assumed size and the article's section."
          />
          <FormulaCard
            title="Engagement Rate"
            formula="0.02 × (1 + |sentiment|) × section_engagement_factor"
            explanation="Strong sentiment — positive or negative — increases engagement, a well-documented media pattern."
          />
          <FormulaCard
            title="Click-Through Rate (CTR)"
            formula="0.03 × title_length_factor × keyword_relevance_factor"
            explanation="Shorter titles (≤60 chars) and titles containing the searched topic get a boost."
          />
          <FormulaCard
            title="Cost per Engagement (CPE)"
            formula="50 / (engagement_rate × 100)"
            explanation="A fixed hypothetical $50 budget unit divided by engagement — higher engagement means lower cost per engagement."
          />
          <FormulaCard
            title="Earned Media Value (EMV)"
            formula="impressions × $0.01 × (1 + sentiment)"
            explanation="$0.01 assumed value per impression, scaled 0×–2× by sentiment."
          />
          <FormulaCard
            title="ROI Index"
            formula="(EMV − paid cost) / paid cost,  paid cost = impressions × $15 CPM ÷ 1000"
            explanation="Compares earned value against what the same reach would cost as a paid placement. Mathematically, since both EMV and paid cost scale with impressions, ROI Index reduces to a pure function of sentiment — a scale-independent efficiency metric, not a 'bigger publishers automatically win' number."
          />
        </div>
      </div>

      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Spike detection</div>
        <div className="text-sm" style={{ color: "#3A4150" }}>
          A period is flagged as a statistical spike when its volume exceeds the mean plus 1.5
          standard deviations across the currently displayed periods — a simple, explainable
          statistical rule, not a machine-learning anomaly detector. This threshold is computed
          fresh for whatever topic, date range, and channels are currently selected.
        </div>
      </div>

      <div>
        <div className="mb-3 font-serif text-lg" style={{ color: INK }}>Best &amp; Worst titles</div>
        <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
          <p className="text-sm" style={{ color: "#3A4150" }}>
            The top and bottom 20 individual articles matching the current topic search, for the
            selected date range, sorted by real per-article values (sentiment score, estimated
            impressions, or engagement rate) — a plain sort, not a mined or aggregated metric. No
            keyword extraction or category classification is involved.
          </p>
        </div>
      </div>

      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Data quality notes</div>
        <div className="flex flex-col gap-3 text-sm" style={{ color: "#3A4150" }}>
          <p>
            <strong>Dataset:</strong> "All the News 2.0" (Andrew Thompson), sourced from Hugging Face.
            Contains approximately 74,700 articles from 7 US publications published between
            January 2016 and mid-July 2019.
          </p>
          <p>
            <strong>Missing fields:</strong> Approximately 28% of articles have no author metadata,
            and approximately 55% have no editorial section metadata. These gaps are inherent in the
            source dataset and affect Section-based analyses (Discussion Contexts, section weights
            in KPI formulas). Articles with missing sections receive a neutral section weight of 1.0.
          </p>
          <p>
            <strong>June 2019 anomaly:</strong> A volume spike in June 2019 appears across all topics
            and all publications simultaneously. This is a corpus-wide collection artifact near the
            dataset's end date, not a real coverage event. Keep this in mind when analyzing trends
            that include mid-2019.
          </p>
          <p>
            <strong>Synthetic KPIs:</strong> Layer 2 metrics (Impressions, Engagement Rate, CTR, CPE,
            EMV, ROI Index) are formula-driven from documented assumption constants, not measured from
            real traffic or ad data. Articles from the same publication and section will produce
            identical impressions and similar engagement values by design. These metrics demonstrate
            the explainability framework, not real performance measurement.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Reads the current URL's query params once, used to restore a shared view. */
function readUrlParams() {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

function ChatWidget({ getContext }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          context: getContext(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages((m) => [...m, { role: "assistant", content: `(Error: ${data.error}${data.detail ? " — " + data.detail : ""})` }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `(Network error reaching the assistant: ${String(err)})` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex w-96 flex-col rounded-sm border shadow-lg"
          style={{ borderColor: "#D9D2C2", background: PAPER, height: 480 }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "#D9D2C2", background: INK }}>
            <span className="font-serif text-sm" style={{ color: PAPER }}>OMEA Data Assistant</span>
            <button onClick={() => setOpen(false)} style={{ color: PAPER }}>✕</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "#FBFAF6" }}>
            {messages.length === 0 && (
              <div className="text-xs italic" style={{ color: SUBTEXT }}>
                Ask about the live data — e.g. "What's Facebook's ROI in 2018?" or "Which publication has the best sentiment?"
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-sm px-3 py-2 text-xs"
                  style={{
                    background: m.role === "user" ? INK : "#EFEAE0",
                    color: m.role === "user" ? PAPER : INK,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs" style={{ color: SUBTEXT }}>
                <Loader2 size={12} className="animate-spin" /> Querying live data…
              </div>
            )}
          </div>
          <form onSubmit={sendMessage} className="flex items-center gap-2 border-t p-3" style={{ borderColor: "#D9D2C2" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 rounded-sm border px-3 py-2 text-xs outline-none"
              style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: INK }}
            />
            <button type="submit" disabled={loading} className="rounded-sm px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ background: INK, color: PAPER }}>
              Send
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg"
        style={{ background: INK, color: GOLD }}
        title="Ask the OMEA data assistant"
      >
        <MessageCircle size={24} />
      </button>
    </>
  );
}

export default function OmeaDashboard() {
  const initialParams = useRef(readUrlParams()).current;
  const initialPubsRef = useRef(initialParams.pubs ? initialParams.pubs.split(",") : null);

  const [persona, setPersona] = useState(initialParams.persona || "owner");

  const [query, setQuery] = useState(initialParams.topic || "Facebook");
  const [currentTopicName, setCurrentTopicName] = useState(initialParams.topic || "Facebook");

  const [selectedPubs, setSelectedPubs] = useState([]);

  const [dateFrom, setDateFrom] = useState(initialParams.from || "");
  const [dateTo, setDateTo] = useState(initialParams.to || "");
  const [interval, setInterval] = useState(initialParams.interval || "month");
  const dateRange = { from: dateFrom || undefined, to: dateTo || undefined };

  const [phraseLength, setPhraseLength] = useState(1);
  const [keywords, setKeywords] = useState([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);

  const [contexts, setContexts] = useState({ sections: [], totalMatched: 0, monthlyBySection: {} });
  const [contextsLoading, setContextsLoading] = useState(false);

  const [sentimentDistribution, setSentimentDistribution] = useState([]);
  const [articleSample, setArticleSample] = useState({ articles: [], totalMatched: 0 });
  const [analystExtrasLoading, setAnalystExtrasLoading] = useState(false);

  const [kpiByPublication, setKpiByPublication] = useState({});
  const [kpiByPublicationLoading, setKpiByPublicationLoading] = useState(false);

  const { topic, loading, error } = useTopic(currentTopicName, dateRange, interval);

  const [priorSummary, setPriorSummary] = useState(null);
  useEffect(() => {
    if (!topic?.label || selectedPubs.length === 0) return;
    let cancelled = false;
    fetchPriorPeriodSummary(topic.label, dateRange, selectedPubs)
      .then((data) => { if (!cancelled) setPriorSummary(data); })
      .catch(() => { if (!cancelled) setPriorSummary(null); });
    return () => { cancelled = true; };
  }, [topic?.label, dateFrom, dateTo, selectedPubs]);

  useEffect(() => {
    if (!topic) return;
    if (initialPubsRef.current) {
      const valid = initialPubsRef.current.filter((name) => topic.publications.some((p) => p.name === name));
      setSelectedPubs(valid.length > 0 ? valid : topic.publications.map((p) => p.name));
      initialPubsRef.current = null;
    } else {
      setSelectedPubs(topic.publications.map((p) => p.name));
    }
  }, [topic]);

  // Keeps the URL in sync with current state so the "Copy Link" button
  // produces a genuinely restorable view, not just the current page.
  useEffect(() => {
    const params = new URLSearchParams();
    if (currentTopicName) params.set("topic", currentTopicName);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (interval !== "month") params.set("interval", interval);
    if (persona !== "owner") params.set("persona", persona);
    if (selectedPubs.length > 0) params.set("pubs", selectedPubs.join(","));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }, [currentTopicName, dateFrom, dateTo, interval, persona, selectedPubs]);

  // Keywords load independently of the main topic data.
  useEffect(() => {
    if (!topic?.label || selectedPubs.length === 0) return;
    let cancelled = false;
    setKeywordsLoading(true);
    fetchKeywordProminence(topic.label, phraseLength, dateRange, selectedPubs)
      .then((data) => { if (!cancelled) setKeywords(data); })
      .catch(() => { if (!cancelled) setKeywords([]); })
      .finally(() => { if (!cancelled) setKeywordsLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, phraseLength, dateFrom, dateTo, selectedPubs]);

  // Discussion contexts load once per topic (not tied to phrase length).
  useEffect(() => {
    if (!topic?.label || selectedPubs.length === 0) return;
    let cancelled = false;
    setContextsLoading(true);
    fetchContextBreakdown(topic.label, dateRange, interval, selectedPubs)
      .then((data) => { if (!cancelled) setContexts(data); })
      .catch(() => { if (!cancelled) setContexts({ sections: [], totalMatched: 0, monthlyBySection: {} }); })
      .finally(() => { if (!cancelled) setContextsLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, dateFrom, dateTo, interval, selectedPubs]);

  // Analyst-only extras (sentiment histogram + article sample for scatter
  // charts) load only when the Data Analyst tab is active, since they're
  // not needed for the other two views.
  useEffect(() => {
    if (!topic?.label || persona !== "analyst" || selectedPubs.length === 0) return;
    let cancelled = false;
    setAnalystExtrasLoading(true);
    Promise.all([
      fetchSentimentDistribution(topic.label, dateRange, selectedPubs),
      fetchArticleSample(topic.label, dateRange, selectedPubs),
    ])
      .then(([dist, sample]) => {
        if (!cancelled) { setSentimentDistribution(dist); setArticleSample(sample); }
      })
      .catch(() => { if (!cancelled) { setSentimentDistribution([]); setArticleSample({ articles: [], totalMatched: 0 }); } })
      .finally(() => { if (!cancelled) setAnalystExtrasLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, dateFrom, dateTo, selectedPubs, persona]);

  // KPI-by-publication breakdown for the clustered comparison chart —
  // also analyst-only, and depends on interval too since it's period-based.
  useEffect(() => {
    if (!topic?.label || persona !== "analyst" || selectedPubs.length === 0) return;
    let cancelled = false;
    setKpiByPublicationLoading(true);
    fetchMonthlyKpiBreakdown(topic.label, dateRange, interval, selectedPubs)
      .then((data) => { if (!cancelled) setKpiByPublication(data); })
      .catch(() => { if (!cancelled) setKpiByPublication({}); })
      .finally(() => { if (!cancelled) setKpiByPublicationLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, dateFrom, dateTo, interval, selectedPubs, persona]);

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim()) setCurrentTopicName(query.trim());
  }

  function handlePivot(keyword) {
    setQuery(keyword);
    setCurrentTopicName(keyword);
  }

  const [linkCopied, setLinkCopied] = useState(false);
  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen w-full" style={{ background: PAPER }}>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-2 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-start md:justify-between" style={{ borderColor: "#D9D2C2" }}>
          <div>
            <div className="font-serif text-2xl tracking-tight" style={{ color: INK }}>
              OMEA
            </div>
            <div className="text-xs" style={{ color: SUBTEXT }}>
              Online Media Effectiveness Analytics &middot; 7 publications, 2016&ndash;2019
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <div className="flex items-center gap-2">
              <form onSubmit={handleSearch} className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-sm border px-3 py-2" style={{ borderColor: INK, background: "#FBFAF6" }}>
                  <Search size={15} style={{ color: SUBTEXT }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a brand, topic, or entity..."
                    className="w-48 bg-transparent text-sm outline-none"
                    style={{ color: INK }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-sm px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ background: INK, color: PAPER }}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : "Analyze"}
                </button>
              </form>
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 rounded-sm border px-3 py-2 text-xs font-medium"
                style={{ borderColor: INK, color: INK, background: "transparent" }}
                title="Copy a shareable link to this exact view"
              >
                {linkCopied ? <Check size={14} /> : <Link2 size={14} />}
                {linkCopied ? "Copied!" : "Copy Link"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs" style={{ color: SUBTEXT }}>Try:</span>
              {["Facebook", "Google", "Amazon", "Apple", "Twitter"].map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); setCurrentTopicName(s); }}
                  className="rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:opacity-80"
                  style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "transparent" }}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="flex rounded-sm border" style={{ borderColor: INK }}>
              {[
                { id: "owner", label: "Marketing Owner" },
                { id: "analyst", label: "Data Analyst" },
                { id: "brands", label: "Subject Compare" },
                { id: "bestworst", label: "Best & Worst" },
                { id: "insights", label: "Content Insights" },
                { id: "methodology", label: "How It Works" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersona(p.id)}
                  className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors"
                  style={{
                    background: persona === p.id ? INK : "transparent",
                    color: persona === p.id ? PAPER : INK,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {persona === "methodology" ? (
          <MethodologyView />
        ) : persona === "brands" ? (
          <>
            <TimeControls
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              interval={interval}
              onIntervalChange={setInterval}
            />
            <BrandComparisonView dateRange={dateRange} interval={interval} initialSubject={currentTopicName} />
          </>
        ) : (
          <>
            <TimeControls
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              interval={interval}
              onIntervalChange={setInterval}
            />

            {error && (
              <div className="mb-6 rounded-sm border px-4 py-3 text-xs" style={{ borderColor: NEG, background: "#FBEBEC", color: "#7A2530" }}>
                {error}
              </div>
            )}

            {loading && !topic && (
              <div className="flex items-center gap-2 py-12 text-sm" style={{ color: SUBTEXT }}>
                <Loader2 size={16} className="animate-spin" /> Loading media data…
              </div>
            )}

            {topic && (
              <>
                <div className="mb-3 -mt-2 flex items-center gap-2">
                  <span className="text-xs" style={{ color: SUBTEXT }}>Currently viewing:</span>
                  <span className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-sm font-medium" style={{ background: INK, color: PAPER }}>
                    {topic.label}
                    <button onClick={() => { setQuery(""); setCurrentTopicName(""); }} style={{ color: PAPER, opacity: 0.6 }} title="Clear topic"><X size={12} /></button>
                  </span>
                  {loading && <span className="text-xs" style={{ color: SUBTEXT }}><Loader2 size={10} className="inline animate-spin" /> refreshing…</span>}
                </div>

                {topic.publications.length === 0 ? (
                  <div className="rounded-sm border px-4 py-6 text-sm" style={{ borderColor: "#D9D2C2", background: "#FBFAF6", color: SUBTEXT }}>
                    No articles found mentioning &ldquo;{topic.label}&rdquo; for this period. Try a
                    different topic or widen the date range.
                  </div>
                ) : (
                  <>
                    <PublicationFilter allPubs={topic.publications} selected={selectedPubs} onChange={setSelectedPubs} />
                    {persona === "owner" ? (
                      <MarketingOwnerView topic={topic} selectedPubs={selectedPubs} priorSummary={priorSummary} dateTo={dateTo} />
                    ) : persona === "analyst" ? (
                      <DataAnalystView
                        topic={topic}
                        selectedPubs={selectedPubs}
                        sentimentDistribution={sentimentDistribution}
                        articleSample={articleSample}
                        analystExtrasLoading={analystExtrasLoading}
                        kpiByPublication={kpiByPublication}
                        kpiByPublicationLoading={kpiByPublicationLoading}
                      />
                    ) : persona === "bestworst" ? (
                      <TitleRankingsView topic={topic} dateRange={dateRange} selectedPubs={selectedPubs} />
                    ) : (
                      <ContentInsightsView
                        keywords={keywords}
                        keywordsLoading={keywordsLoading}
                        phraseLength={phraseLength}
                        onPhraseLengthChange={setPhraseLength}
                        contexts={contexts}
                        contextsLoading={contextsLoading}
                        onPivotSearch={handlePivot}
                        topic={topic.label}
                        dateRange={dateRange}
                        selectedPubs={selectedPubs}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      <ChatWidget getContext={() => ({
        topic: topic?.label,
        dateFrom,
        dateTo,
        interval,
        selectedPubs,
      })} />
    </div>
  );
}
