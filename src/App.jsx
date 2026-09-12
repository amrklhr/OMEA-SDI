import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ScatterChart, Scatter, ZAxis, AreaChart, Area,
} from "recharts";
import {
  Newspaper, TrendingUp, Eye, MousePointerClick, DollarSign, Target, Smile, ChevronDown, ChevronUp, Search, Loader2, Trophy, TrendingDown, Download, Link2, BookOpen, Check, List,
} from "lucide-react";
import {
  fetchTopicData, fetchKeywordProminence, fetchContextBreakdown,
  fetchSentimentDistribution, fetchArticleSample,
  fetchArticlesForKeyword, fetchArticlesForSection,
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

function KpiCard({ icon: Icon, label, value, tone }) {
  const color = tone === "pos" ? POS : tone === "neg" ? NEG : INK;
  return (
    <div className="flex flex-col gap-3 rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="flex items-center gap-2" style={{ color: SUBTEXT }}>
        <Icon size={16} strokeWidth={1.75} />
        <span className="text-xs tracking-wide">{label}</span>
      </div>
      <div className="font-mono text-3xl" style={{ color }}>{value}</div>
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

function SpikeDot({ cx, cy, payload, spikes }) {
  if (!spikes.has(payload.m)) return null;
  return <circle cx={cx} cy={cy} r={5} fill={GOLD} stroke={INK} strokeWidth={1.5} />;
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
          <Search size={11} /> Analyze
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
        <div className="flex rounded-sm border" style={{ borderColor: INK }}>
          {LENGTHS.map((l) => (
            <button
              key={l.n}
              onClick={() => onPhraseLengthChange(l.n)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: phraseLength === l.n ? INK : "transparent",
                color: phraseLength === l.n ? PAPER : INK,
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
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
        <div className="flex flex-col gap-3">
          {keywords.map((k) => (
            <KeywordRow key={k.key} k={k} topic={topic} dateRange={dateRange} selectedPubs={selectedPubs} onPivot={onPivot} />
          ))}
        </div>
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

function MarketingOwnerView({ topic, selectedPubs }) {
  const pubs = topic.publications.filter((p) => selectedPubs.includes(p.name));
  const volume = pubs.reduce((sum, p) => sum + p.articles, 0);
  const impressions = pubs.reduce((sum, p) => sum + p.impressions, 0);
  const emv = pubs.reduce((sum, p) => sum + p.emv, 0);
  const wAvg = (key) => (volume === 0 ? 0 : pubs.reduce((sum, p) => sum + p[key] * p.articles, 0) / volume);
  const sentiment = wAvg("sentiment");
  const engagement = wAvg("engagement");
  const roi = wAvg("roi");
  const isFiltered = selectedPubs.length < topic.publications.length;

  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  const chartData = sortedMonths.map((m) => ({
    m,
    v: selectedPubs.reduce((sum, pubName) => sum + (topic.monthlyByPublication[pubName]?.[m] || 0), 0),
  }));
  const spikes = detectSpikes(chartData);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-end">
        <button
          onClick={() => exportKpiSummaryCSV(topic, selectedPubs)}
          className="flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "#D9D2C2", color: SUBTEXT, background: "#FBFAF6" }}
        >
          <Download size={13} /> Export summary CSV
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={Newspaper} label="Coverage Volume" value={fmtNum(volume)} />
        <KpiCard icon={Smile} label="Avg. Sentiment" value={(sentiment >= 0 ? "+" : "") + sentiment.toFixed(2)} tone={sentiment >= 0 ? "pos" : "neg"} />
        <KpiCard icon={Eye} label="Est. Impressions" value={`${(impressions / 1_000_000).toFixed(1)}M`} />
        <KpiCard icon={TrendingUp} label="Engagement Rate" value={fmtPct(engagement)} />
        <KpiCard icon={MousePointerClick} label="Avg. CTR" value={fmtPct(topic.summary.ctr)} />
        <KpiCard icon={DollarSign} label="Earned Media Value" value={`$${(emv / 1000).toFixed(1)}K`} tone="pos" />
        <KpiCard icon={Target} label="ROI Index" value={fmtPct(roi)} tone={roi >= 0 ? "pos" : "neg"} />
      </div>

      <SpotlightCard spotlight={topic.spotlight} />

      <MediaSharePie publications={topic.publications} selectedPubs={selectedPubs} />

      <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
        <div className="mb-1 font-serif text-lg" style={{ color: INK }}>
          Coverage volume over time
        </div>
        <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
          {isFiltered
            ? `Showing ${selectedPubs.length} of ${topic.publications.length} selected channels.`
            : "Live data from your OpenSearch index."}
          {spikes.size > 0 && (
            <span> Gold points mark statistically detected spikes (volume &gt; mean + 1.5&times;std dev): {[...spikes].join(", ")}.</span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#E3DDCE" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(chartData.length / 8)} />
            <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
            <Tooltip
              contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }}
              labelStyle={{ color: INK }}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke={INK}
              strokeWidth={2}
              dot={(props) => <SpikeDot key={props.payload.m} {...props} spikes={spikes} />}
              name="Articles"
            />
          </LineChart>
        </ResponsiveContainer>
        <StatsRow items={[
          { label: "Total", value: fmtNum(computeStats(chartData.map((d) => d.v)).total) },
          { label: "Avg / period", value: computeStats(chartData.map((d) => d.v)).avg.toFixed(1) },
          { label: "Median / period", value: fmtNum(computeStats(chartData.map((d) => d.v)).median) },
        ]} />
      </div>

      <RevenueChart monthlyEmvByPublication={topic.monthlyEmvByPublication} selectedPubs={selectedPubs} />
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
  (sample || []).forEach((a) => {
    if (!selectedPubs.includes(a.publication)) return;
    (byPub[a.publication] = byPub[a.publication] || []).push({ x: a.sentiment_score, y: a.roi_index });
    allPoints.push(a.roi_index);
  });
  const stats = computeStats(allPoints);
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Sentiment vs. ROI Index</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Each point is one article — makes the ROI formula's dependence on sentiment visually inspectable, colored by publication.
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
          { label: "Articles (n)", value: fmtNum(allPoints.length) },
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
  (sample || []).forEach((a) => {
    if (!selectedPubs.includes(a.publication)) return;
    (byPub[a.publication] = byPub[a.publication] || []).push({ x: a.word_count, y: a.engagement_rate });
    allEngagement.push(a.engagement_rate);
  });
  const stats = computeStats(allEngagement);
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Article length vs. engagement</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Tests whether longer, more substantial articles about this topic actually perform differently.
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
          { label: "Articles (n)", value: fmtNum(allEngagement.length) },
          { label: "Avg engagement", value: fmtPct(stats.avg) },
          { label: "Median engagement", value: fmtPct(stats.median) },
        ]} />
      )}
    </div>
  );
}

function CumulativeCoverageChart({ topic, selectedPubs }) {
  const sortedMonths = combinedMonths(topic.monthlyByPublication, selectedPubs);
  let running = 0;
  const periodTotals = [];
  const data = sortedMonths.map((m) => {
    const periodTotal = selectedPubs.reduce((sum, p) => sum + (topic.monthlyByPublication[p]?.[m] || 0), 0);
    periodTotals.push(periodTotal);
    running += periodTotal;
    return { m, cumulative: running };
  });
  const stats = computeStats(periodTotals);
  return (
    <div className="rounded-sm border p-5" style={{ borderColor: "#D9D2C2", background: "#FBFAF6" }}>
      <div className="mb-1 font-serif text-lg" style={{ color: INK }}>Cumulative coverage growth</div>
      <div className="mb-4 text-xs" style={{ color: SUBTEXT }}>
        Running total of articles over time — shows overall momentum rather than period-to-period noise.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#E3DDCE" vertical={false} />
          <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTEXT }} interval={Math.ceil(data.length / 8)} />
          <YAxis tick={{ fontSize: 10, fill: SUBTEXT }} />
          <Tooltip contentStyle={{ borderRadius: 2, borderColor: "#D9D2C2", fontSize: 12 }} formatter={(v) => [fmtNum(v), "Cumulative articles"]} />
          <Area type="monotone" dataKey="cumulative" stroke={INK} fill={GOLD} fillOpacity={0.3} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      <StatsRow items={[
        { label: "Total", value: fmtNum(running) },
        { label: "Avg / period", value: stats.avg.toFixed(1) },
        { label: "Median / period", value: fmtNum(stats.median) },
      ]} />
    </div>
  );
}

function DataAnalystView({ topic, selectedPubs, sentimentDistribution, articleSample, analystExtrasLoading }) {
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
          &middot; {filtered.length} publication{filtered.length !== 1 ? "s" : ""}, {fmtNum(filtered.reduce((s, p) => s + p.articles, 0))} articles. Click a row to trace its formula.
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

      <div className="grid gap-8 md:grid-cols-2">
        <SentimentHistogram data={sentimentDistribution} loading={analystExtrasLoading} />
        <CpeByPublicationChart publications={topic.publications} selectedPubs={selectedPubs} />
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <SentimentRoiScatter sample={articleSample} selectedPubs={selectedPubs} loading={analystExtrasLoading} />
        <WordCountEngagementScatter sample={articleSample} selectedPubs={selectedPubs} loading={analystExtrasLoading} />
      </div>

      <CumulativeCoverageChart topic={topic} selectedPubs={selectedPubs} />

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
            className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: active ? INK : "#D9D2C2",
              background: active ? INK : "transparent",
              color: active ? PAPER : SUBTEXT,
            }}
          >
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
              ? "Could not reach OpenSearch at localhost:9200. Make sure Docker is running and CORS is enabled."
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
    </div>
  );
}

/** Reads the current URL's query params once, used to restore a shared view. */
function readUrlParams() {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
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
  const [articleSample, setArticleSample] = useState([]);
  const [analystExtrasLoading, setAnalystExtrasLoading] = useState(false);

  const { topic, loading, error } = useTopic(currentTopicName, dateRange, interval);

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
      .catch(() => { if (!cancelled) { setSentimentDistribution([]); setArticleSample([]); } })
      .finally(() => { if (!cancelled) setAnalystExtrasLoading(false); });
    return () => { cancelled = true; };
  }, [topic?.label, dateFrom, dateTo, selectedPubs, persona]);

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
              Online Media Effectiveness Analytics &middot; live OpenSearch data
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

            <div className="flex rounded-sm border" style={{ borderColor: INK }}>
              {[
                { id: "owner", label: "Marketing Owner" },
                { id: "analyst", label: "Data Analyst" },
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
                  {p.id === "methodology" && <BookOpen size={14} />}
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {persona === "methodology" ? (
          <MethodologyView />
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
                <Loader2 size={16} className="animate-spin" /> Querying OpenSearch…
              </div>
            )}

            {topic && (
              <>
                <div className="mb-2 -mt-2 text-xs" style={{ color: SUBTEXT }}>
                  Currently viewing: <span className="font-mono">{topic.label}</span>
                  {loading && <span className="ml-2"><Loader2 size={10} className="inline animate-spin" /> refreshing…</span>}
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
                      <MarketingOwnerView topic={topic} selectedPubs={selectedPubs} />
                    ) : persona === "analyst" ? (
                      <DataAnalystView
                        topic={topic}
                        selectedPubs={selectedPubs}
                        sentimentDistribution={sentimentDistribution}
                        articleSample={articleSample}
                        analystExtrasLoading={analystExtrasLoading}
                      />
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
    </div>
  );
}
