'use client';

import { useMemo, useState } from "react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import {
  CompanyTarget,
  ConsolidatedNewsItem,
  KeywordSourceRow,
  NewsletterColumn,
  TimeRangeOption,
} from "@/lib/types";
import { normalizeKeywordRow } from "@/lib/keywords";

const AVAILABLE_COLUMNS: { id: NewsletterColumn; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "source", label: "Source" },
  { id: "published", label: "Published" },
  { id: "summary", label: "Summary" },
  { id: "url", label: "Link" },
  { id: "authenticScore", label: "Authentic Score" },
  { id: "marketImpactScore", label: "Market Impact Score" },
  { id: "keyword", label: "Keyword" },
  { id: "sopCategory", label: "SOP Category" },
  { id: "businessCategory", label: "Business Category" },
];

const DEFAULT_COLUMNS: NewsletterColumn[] = [
  "title",
  "source",
  "published",
  "summary",
  "url",
  "authenticScore",
  "marketImpactScore",
  "keyword",
  "sopCategory",
];

type FiltersState = {
  keyword: string;
  company: string;
  searchTerm: string;
  minAuthentic: number;
  minImpact: number;
  timeWindow: "all" | "24h" | "3d" | "7d";
};

const EMPTY_FILTERS: FiltersState = {
  keyword: "all",
  company: "all",
  searchTerm: "",
  minAuthentic: 0,
  minImpact: 0,
  timeWindow: "all",
};

function getId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value: string) {
  try {
    return format(new Date(value), "MMM d, yyyy HH:mm");
  } catch {
    return value;
  }
}

async function parseWorkbook(file: File): Promise<KeywordSourceRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const primarySheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(primarySheet, {
    raw: false,
    defval: "",
  });
  return rows
    .map(normalizeKeywordRow)
    .filter((row) => row.keyword.trim().length > 0);
}

export default function Home() {
  const [keywordRows, setKeywordRows] = useState<KeywordSourceRow[]>([]);
  const [companyTargets, setCompanyTargets] = useState<CompanyTarget[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeOption>({ preset: "7d" });
  const [maxItems, setMaxItems] = useState<number>(60);
  const [selectedColumns, setSelectedColumns] =
    useState<NewsletterColumn[]>(DEFAULT_COLUMNS);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [results, setResults] = useState<ConsolidatedNewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const keywordOptions = useMemo(() => {
    return Array.from(new Set(keywordRows.map((row) => row.keyword)));
  }, [keywordRows]);

  const companyOptions = useMemo(() => {
    const companies = new Set<string>();
    results.forEach((item) =>
      item.companyMatches.forEach((company) => companies.add(company)),
    );
    return Array.from(companies);
  }, [results]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      if (filters.keyword !== "all") {
        const matchesKeyword = item.keywordMatches.includes(filters.keyword);
        if (!matchesKeyword) return false;
      }

      if (filters.company !== "all") {
        const matchesCompany = item.companyMatches.includes(filters.company);
        if (!matchesCompany) return false;
      }

      if (filters.searchTerm.trim().length > 0) {
        const needle = filters.searchTerm.trim().toLowerCase();
        const haystack = `${item.title} ${item.summary} ${item.source}`.toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }

      if (item.authenticScore < filters.minAuthentic) return false;
      if (item.marketImpactScore < filters.minImpact) return false;

      if (filters.timeWindow !== "all") {
        const published = new Date(item.publishedAt).getTime();
        const now = Date.now();
        const limit =
          filters.timeWindow === "24h"
            ? 24 * 60 * 60 * 1000
            : filters.timeWindow === "3d"
              ? 3 * 24 * 60 * 60 * 1000
              : 7 * 24 * 60 * 60 * 1000;
        if (now - published > limit) {
          return false;
        }
      }

      return true;
    });
  }, [filters, results]);

  async function handleSearch() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: keywordRows,
          companyTargets,
          timeRange,
          maxItems,
        }),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const payload = await response.json();
      setResults(payload.results);
      setLastRun(new Date());
    } catch (cause) {
      console.error(cause);
      setError("Unable to retrieve news. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFileUpload(list: FileList | null) {
    if (!list || list.length === 0) return;
    try {
      const rows = await parseWorkbook(list[0]);
      setKeywordRows(rows);
    } catch (cause) {
      console.error(cause);
      setError("Unable to parse the uploaded XLSX file.");
    }
  }

  function updateKeyword(
    index: number,
    field: keyof KeywordSourceRow,
    value: string,
  ) {
    setKeywordRows((prev) => {
      const next = [...prev];
      const current = { ...next[index] };
      if (field === "companies") {
        current.companies = value
          .split(/[,;]+/)
          .map((entry) => entry.trim())
          .filter(Boolean);
      } else {
        (current as Record<string, unknown>)[field] = value;
      }
      next[index] = current;
      return next;
    });
  }

  function addKeyword() {
    setKeywordRows((prev) => [
      ...prev,
      { keyword: "New keyword", sopCategory: "", businessCategory: "" },
    ]);
  }

  function removeKeyword(keyword: string) {
    setKeywordRows((prev) => prev.filter((row) => row.keyword !== keyword));
  }

  function addCompanyTarget() {
    setCompanyTargets((prev) => [...prev, { id: getId(), label: "", url: "" }]);
  }

  function updateCompanyTarget(
    id: string,
    field: keyof CompanyTarget,
    value: string,
  ) {
    setCompanyTargets((prev) =>
      prev.map((target) =>
        target.id === id
          ? {
              ...target,
              [field]: value,
            }
          : target,
      ),
    );
  }

  function removeCompanyTarget(id: string) {
    setCompanyTargets((prev) => prev.filter((target) => target.id !== id));
  }

  function toggleColumn(column: NewsletterColumn) {
    setSelectedColumns((prev) =>
      prev.includes(column)
        ? prev.filter((item) => item !== column)
        : [...prev, column],
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 pb-24 text-slate-50">
      <section className="border-b border-slate-900/80 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Biosimilar Intelligence Console
          </h1>
          <p className="mt-4 max-w-3xl text-base text-slate-300">
            Upload SOP-driven keyword taxonomies, run AI-expanded news discovery,
            and compose stakeholder-ready biosimilar bulletins with automated
            scoring.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span className="rounded-full border border-slate-700 px-3 py-1">
              SOP Categorization
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              AI-Expanded Search
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Authenticity Scoring
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Impact Prioritization
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-10 px-6 pt-12">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
            <header className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">SOP Keyword Taxonomy</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Upload XLSX inventories or fine-tune categories inline.
                </p>
              </div>
              <button
                onClick={addKeyword}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Add Keyword
              </button>
            </header>

            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-6">
              <label
                htmlFor="keyword-upload"
                className="flex cursor-pointer flex-col items-center gap-3 text-center"
              >
                <span className="text-lg font-medium text-white">
                  Drag &amp; Drop XLSX
                </span>
                <span className="text-sm text-slate-400">
                  Include columns like Keyword, SOP Category, Business Category, Companies.
                </span>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide">
                  Browse files
                </span>
              </label>
              <input
                id="keyword-upload"
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => handleFileUpload(event.target.files)}
              />
            </div>

            {keywordRows.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">
                No keywords yet. Upload an XLSX or add records manually.
              </p>
            ) : (
              <div className="mt-6 overflow-hidden rounded-xl border border-slate-900/70">
                <table className="min-w-full divide-y divide-slate-900/70 text-sm">
                  <thead className="bg-slate-900/80 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Keyword</th>
                      <th className="px-4 py-3 text-left font-medium">SOP Category</th>
                      <th className="px-4 py-3 text-left font-medium">Business Category</th>
                      <th className="px-4 py-3 text-left font-medium">Companies</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60 text-slate-200">
                    {keywordRows.map((row, index) => (
                      <tr key={`${row.keyword}-${index}`}>
                        <td className="px-4 py-3">
                          <input
                            value={row.keyword}
                            onChange={(event) =>
                              updateKeyword(index, "keyword", event.target.value)
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={row.sopCategory ?? ""}
                            onChange={(event) =>
                              updateKeyword(index, "sopCategory", event.target.value)
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={row.businessCategory ?? ""}
                            onChange={(event) =>
                              updateKeyword(index, "businessCategory", event.target.value)
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={row.companies?.join(", ") ?? ""}
                            onChange={(event) =>
                              updateKeyword(index, "companies", event.target.value)
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => removeKeyword(row.keyword)}
                            className="rounded-md border border-transparent px-3 py-1 text-sm text-slate-300 transition hover:border-red-500 hover:text-red-300"
                            aria-label={`Remove ${row.keyword}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
              <h2 className="text-xl font-semibold">Company Watchlist</h2>
              <p className="mt-1 text-sm text-slate-400">
                Target specific corporate or regulatory sources for prioritized scraping.
              </p>
              <div className="mt-4 space-y-4">
                {companyTargets.map((target) => (
                  <div
                    key={target.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="grid gap-3">
                      <input
                        value={target.label}
                        onChange={(event) =>
                          updateCompanyTarget(target.id, "label", event.target.value)
                        }
                        placeholder="Label (e.g., Amgen IR feed)"
                        className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                      />
                      <input
                        value={target.url}
                        onChange={(event) =>
                          updateCompanyTarget(target.id, "url", event.target.value)
                        }
                        placeholder="https://"
                        className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                      />
                      <button
                        onClick={() => removeCompanyTarget(target.id)}
                        className="self-end rounded-md border border-transparent px-3 py-1 text-sm text-slate-300 transition hover:border-red-500 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={addCompanyTarget}
                className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Add Company Target
              </button>
            </div>

            <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
              <h2 className="text-xl font-semibold">Retrieval Cadence</h2>
              <p className="mt-1 text-sm text-slate-400">
                Define how far back to scan and cap total returned stories.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { value: "24h", label: "24 Hours" },
                  { value: "3d", label: "3 Days" },
                  { value: "7d", label: "7 Days" },
                  { value: "30d", label: "30 Days" },
                  { value: "custom", label: "Custom" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      if (option.value === "custom") {
                        setTimeRange({
                          preset: "custom",
                          from: new Date().toISOString(),
                          to: new Date().toISOString(),
                        });
                      } else {
                        setTimeRange({
                          preset: option.value as Exclude<
                            TimeRangeOption["preset"],
                            "custom"
                          >,
                        });
                      }
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      timeRange.preset === option.value
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-200"
                        : "border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {timeRange.preset === "custom" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    From
                    <input
                      type="datetime-local"
                      value={("from" in timeRange ? timeRange.from : "").slice(0, 16)}
                      onChange={(event) =>
                        setTimeRange((prev) => ({
                          preset: "custom",
                          from: event.target.value,
                          to:
                            prev.preset === "custom"
                              ? prev.to
                              : new Date().toISOString(),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    To
                    <input
                      type="datetime-local"
                      value={("to" in timeRange ? timeRange.to : "").slice(0, 16)}
                      onChange={(event) =>
                        setTimeRange((prev) => ({
                          preset: "custom",
                          from:
                            prev.preset === "custom"
                              ? prev.from
                              : new Date().toISOString(),
                          to: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                    />
                  </label>
                </div>
              )}
              <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400">
                Max Results
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={maxItems}
                  onChange={(event) => setMaxItems(Number(event.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Execute Discovery</h2>
              <p className="mt-1 text-sm text-slate-400">
                Launch federated monitoring across web search, company feeds, and heuristic AI expansion.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {lastRun && (
                <span className="text-sm text-slate-400">
                  Last run: {formatDate(lastRun.toISOString())}
                </span>
              )}
              <button
                onClick={handleSearch}
                disabled={isLoading || keywordRows.length === 0}
                className="rounded-xl border border-emerald-400/60 bg-emerald-400/10 px-5 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              >
                {isLoading ? "Scanning..." : "Run Monitoring Cycle"}
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
            <header className="flex flex-col gap-6 border-b border-slate-900/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Intelligence Feed</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Refine by SOP alignment, company, recency, and scoring to isolate the most actionable signals.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <span>
                  Total: <span className="text-slate-100">{results.length}</span>
                </span>
                <span>
                  Showing: <span className="text-slate-100">{filteredResults.length}</span>
                </span>
              </div>
            </header>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Keyword focus
                <select
                  value={filters.keyword}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, keyword: event.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                >
                  <option value="all">All keywords</option>
                  {keywordOptions.map((keyword) => (
                    <option key={keyword} value={keyword}>
                      {keyword}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Company focus
                <select
                  value={filters.company}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, company: event.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                >
                  <option value="all">All companies</option>
                  {companyOptions.map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Free text search
                <input
                  value={filters.searchTerm}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, searchTerm: event.target.value }))
                  }
                  placeholder="Biosimilar launch..."
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                />
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Result recency
                <select
                  value={filters.timeWindow}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      timeWindow: event.target.value as FiltersState["timeWindow"],
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                >
                  <option value="all">Within monitoring window</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="3d">Last 3 days</option>
                  <option value="7d">Last 7 days</option>
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Authentic score (min)
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={filters.minAuthentic}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      minAuthentic: Number(event.target.value),
                    }))
                  }
                  className="mt-2"
                />
                <span className="mt-1 block text-sm text-slate-300">
                  {filters.minAuthentic}
                </span>
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Market impact (min)
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={filters.minImpact}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      minImpact: Number(event.target.value),
                    }))
                  }
                  className="mt-2"
                />
                <span className="mt-1 block text-sm text-slate-300">
                  {filters.minImpact}
                </span>
              </label>
            </div>

            <div className="mt-6 space-y-4">
              {filteredResults.length === 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-sm text-slate-400">
                  No signals match the active filters. Adjust filters or launch a new cycle.
                </div>
              )}

              {filteredResults.map((item) => (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 transition hover:border-emerald-400/50 hover:shadow-lg hover:shadow-emerald-500/10"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                        <span className="rounded-full border border-slate-700 px-3 py-1">
                          {item.source}
                        </span>
                        {item.sopCategory && (
                          <span className="rounded-full border border-slate-700 px-3 py-1">
                            {item.sopCategory}
                          </span>
                        )}
                        {item.businessCategory && (
                          <span className="rounded-full border border-slate-700 px-3 py-1">
                            {item.businessCategory}
                          </span>
                        )}
                        {item.keywordMatches.map((keyword) => (
                          <span
                            key={`${item.id}-${keyword}`}
                            className="rounded-full border border-slate-700 px-3 py-1"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block text-lg font-semibold text-emerald-200 hover:text-emerald-100"
                      >
                        {item.title}
                      </a>
                      <p className="mt-2 text-sm text-slate-300">
                        {item.summary || "No summary available."}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>{formatDate(item.publishedAt)}</span>
                        {item.companyMatches.length > 0 && (
                          <span>
                            Companies:
                            {item.companyMatches.map((company) => (
                              <span
                                key={`${item.id}-${company}`}
                                className="ml-1 rounded-md border border-slate-700 px-2 py-0.5"
                              >
                                {company}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-end">
                      <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-center">
                        <div className="text-xs uppercase text-slate-500">Authentic</div>
                        <div className="text-lg font-semibold text-white">
                          {item.authenticScore}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-center">
                        <div className="text-xs uppercase text-slate-500">Impact</div>
                        <div className="text-lg font-semibold text-white">
                          {item.marketImpactScore}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
              <h2 className="text-xl font-semibold">Newsletter Blueprint</h2>
              <p className="mt-1 text-sm text-slate-400">
                Toggle delivery columns to match stakeholder expectations.
              </p>
              <div className="mt-4 grid gap-3">
                {AVAILABLE_COLUMNS.map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(column.id)}
                      onChange={() => toggleColumn(column.id)}
                      className="h-4 w-4 rounded border border-slate-600 bg-slate-950 text-emerald-400 focus:ring-emerald-300"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-900/70 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">
              <h2 className="text-xl font-semibold">Newsletter Preview</h2>
              <p className="mt-1 text-sm text-slate-400">
                Preview reflects active filters and selected columns.
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="bg-slate-900/70 text-slate-300">
                    <tr>
                      {selectedColumns.map((column) => (
                        <th key={column} className="px-4 py-3 text-left font-medium">
                          {
                            AVAILABLE_COLUMNS.find((entry) => entry.id === column)?.label
                          }
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {filteredResults.slice(0, 12).map((item) => (
                      <tr key={`newsletter-${item.id}`}>
                        {selectedColumns.map((column) => {
                          switch (column) {
                            case "title":
                              return (
                                <td key={`${item.id}-title`} className="px-4 py-3">
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-200 hover:text-emerald-100"
                                  >
                                    {item.title}
                                  </a>
                                </td>
                              );
                            case "source":
                              return (
                                <td key={`${item.id}-source`} className="px-4 py-3">
                                  {item.source}
                                </td>
                              );
                            case "published":
                              return (
                                <td key={`${item.id}-published`} className="px-4 py-3">
                                  {formatDate(item.publishedAt)}
                                </td>
                              );
                            case "summary":
                              return (
                                <td key={`${item.id}-summary`} className="px-4 py-3">
                                  {item.summary}
                                </td>
                              );
                            case "url":
                              return (
                                <td key={`${item.id}-url`} className="px-4 py-3">
                                  {item.url}
                                </td>
                              );
                            case "authenticScore":
                              return (
                                <td key={`${item.id}-authentic`} className="px-4 py-3">
                                  {item.authenticScore}
                                </td>
                              );
                            case "marketImpactScore":
                              return (
                                <td key={`${item.id}-impact`} className="px-4 py-3">
                                  {item.marketImpactScore}
                                </td>
                              );
                            case "keyword":
                              return (
                                <td key={`${item.id}-keyword`} className="px-4 py-3">
                                  {item.keywordMatches.join(", ")}
                                </td>
                              );
                            case "sopCategory":
                              return (
                                <td key={`${item.id}-sop`} className="px-4 py-3">
                                  {item.sopCategory ?? "—"}
                                </td>
                              );
                            case "businessCategory":
                              return (
                                <td key={`${item.id}-business`} className="px-4 py-3">
                                  {item.businessCategory ?? "—"}
                                </td>
                              );
                            default:
                              return null;
                          }
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredResults.length > 12 && (
                <p className="mt-3 text-xs text-slate-400">
                  Showing top 12 records. Additional export tooling can build on this dataset.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
