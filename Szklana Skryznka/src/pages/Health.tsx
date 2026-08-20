import React, { useEffect, useState } from "react";
import { useDiagnosticsStore, useLibraryStore } from "../store";
import { BarChart3, RefreshCw, FileWarning, Copy, Play, Film, Clock, Award, ShieldCheck, Flame, Tv } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

export const Health: React.FC = () => {
  const { report, isLoading, fetchReport } = useDiagnosticsStore();
  const { items, fetchItems } = useLibraryStore();
  const [activeTab, setActiveTab] = useState<"plays" | "telemetry" | "integrity">("plays");

  useEffect(() => {
    fetchReport();
    fetchItems();
  }, [fetchReport, fetchItems]);

  const totalItems = items.length || 1;

  // Calculate total station play count & total runtime
  const totalPlayCount = items.reduce((acc, item) => acc + (item.item.play_count || 0), 0);
  const totalRuntimeSeconds = items.reduce((acc, item) => acc + (item.item.runtime || 0), 0);
  const totalRuntimeHours = Math.round(totalRuntimeSeconds / 3600);

  // Top played items sorted by play count descending
  const topPlayedItems = [...items]
    .sort((a, b) => (b.item.play_count || 0) - (a.item.play_count || 0))
    .slice(0, 10);

  // Calculate percentages for metadata coverage
  const getPercentage = (missingCount: number) => {
    const present = totalItems - missingCount;
    return Math.round((present / totalItems) * 100);
  };

  const posterPercent = getPercentage(report?.missing_posters_count || 0);
  const backdropPercent = getPercentage(report?.missing_backdrops_count || 0);
  const synopsisPercent = getPercentage(report?.missing_synopsis_count || 0);
  const enSubsPercent = getPercentage(report?.missing_english_subs_count || 0);
  const frSubsPercent = getPercentage(report?.missing_french_subs_count || 0);

  // Overall library health score average
  const overallHealth = Math.round(
    (posterPercent + backdropPercent + synopsisPercent + enSubsPercent + frSubsPercent) / 5
  );

  return (
    <div className="flex-1 h-screen flex flex-col justify-between p-6 bg-background text-gray-200 font-mono overflow-hidden">
      {/* HEADER */}
      <div className="space-y-3 shrink-0">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shadow-sm">
              <BarChart3 size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-widest text-accent uppercase">
                STATION STATISTICS & BROADCAST TELEMETRY
              </h1>
              <p className="text-[10px] text-gray-400">
                Playback frequency analytics, library integrity, and asset health metrics
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex bg-gray-900 border border-gray-800 rounded p-0.5 text-xs">
              <button
                onClick={() => setActiveTab("plays")}
                className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                  activeTab === "plays" ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                BROADCAST STATS
              </button>
              <button
                onClick={() => setActiveTab("telemetry")}
                className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                  activeTab === "telemetry" ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                HEALTH METRICS
              </button>
              <button
                onClick={() => setActiveTab("integrity")}
                className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                  activeTab === "integrity" ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                INTEGRITY AUDIT
              </button>
            </div>

            <button
              onClick={() => {
                fetchReport();
                fetchItems();
              }}
              disabled={isLoading}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs rounded px-3 py-1.5 border border-gray-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>

        {/* TOP SUMMARY KPI STATS CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-panel border border-gray-800 rounded-lg p-3.5 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">TOTAL BROADCAST PLAYS</div>
              <div className="text-2xl font-black text-accent mt-0.5">{totalPlayCount.toLocaleString()}</div>
              <div className="text-[9px] text-gray-500 mt-0.5">Cumulative on-air broadcast events</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Flame size={20} />
            </div>
          </div>

          <div className="bg-panel border border-gray-800 rounded-lg p-3.5 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">CATALOG RUNTIME</div>
              <div className="text-2xl font-black text-gray-100 mt-0.5">{totalRuntimeHours.toLocaleString()}h</div>
              <div className="text-[9px] text-gray-500 mt-0.5">{Math.round(totalRuntimeHours / 24)} days of content</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Clock size={20} />
            </div>
          </div>

          <div className="bg-panel border border-gray-800 rounded-lg p-3.5 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">INDEXED ASSETS</div>
              <div className="text-2xl font-black text-purple-400 mt-0.5">{items.length.toLocaleString()}</div>
              <div className="text-[9px] text-gray-500 mt-0.5">Movies, shows & station bumpers</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Film size={20} />
            </div>
          </div>

          <div className="bg-panel border border-gray-800 rounded-lg p-3.5 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">QUALITY SCORE</div>
              <div className={`text-2xl font-black mt-0.5 ${
                overallHealth > 85 ? "text-emerald-400" : overallHealth > 60 ? "text-amber-400" : "text-rose-400"
              }`}>{overallHealth}%</div>
              <div className="text-[9px] text-gray-500 mt-0.5">Station health index</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA BY TAB */}
      <div className="flex-1 min-h-0 mt-3 flex flex-col overflow-hidden">
        {activeTab === "plays" && (
          <div className="flex-1 bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-800 shrink-0">
              <div className="flex items-center space-x-2 text-xs font-bold text-gray-300">
                <Award size={16} className="text-amber-400" />
                <span>MOST PLAYED MOVIES & PROGRAMS (FREQUENCY LEADERBOARD)</span>
              </div>
              <div className="text-[10px] text-gray-500 font-bold">
                RANKED BY ON-AIR AIRPLAY COUNT
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              {topPlayedItems.length > 0 ? (
                topPlayedItems.map((itemDetails, rank) => {
                  const item = itemDetails.item;
                  const firstFile = itemDetails.files[0];
                  const playCount = item.play_count || 0;
                  const posterUrl = item.poster_path
                    ? item.poster_path.startsWith("http")
                      ? item.poster_path
                      : convertFileSrc(item.poster_path)
                    : null;

                  return (
                    <div
                      key={item.id}
                      className="p-2.5 bg-gray-950/80 border border-gray-800/80 rounded-lg hover:border-accent/40 flex items-center justify-between transition-all group"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {/* Rank Badge */}
                        <div className={`w-7 h-7 rounded font-black text-xs flex items-center justify-center shrink-0 ${
                          rank === 0 
                            ? "bg-amber-500 text-black font-extrabold shadow" 
                            : rank === 1 
                            ? "bg-gray-300 text-black font-bold" 
                            : rank === 2 
                            ? "bg-amber-700 text-white font-bold" 
                            : "bg-gray-900 border border-gray-800 text-gray-400"
                        }`}>
                          #{rank + 1}
                        </div>

                        {/* Poster Thumbnail */}
                        <div className="w-10 h-14 bg-gray-900 rounded overflow-hidden shrink-0 border border-gray-800 flex items-center justify-center">
                          {posterUrl ? (
                            <img src={posterUrl} alt={item.title} className="w-full h-full object-cover" />
                          ) : (
                            <Film size={16} className="text-gray-600" />
                          )}
                        </div>

                        {/* Title & Metadata */}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-200 truncate group-hover:text-accent transition-colors">
                            {item.title}
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-gray-500 mt-0.5">
                            <span className="bg-gray-900 border border-gray-800 px-1.5 py-0.2 rounded uppercase font-bold text-[9px] text-gray-400">
                              {item.media_type}
                            </span>
                            {item.year && <span>{item.year}</span>}
                            <span>•</span>
                            <span>{Math.round(item.runtime / 60)}m</span>
                            {firstFile?.resolution && (
                              <>
                                <span>•</span>
                                <span className="text-cyan-400/80">{firstFile.resolution}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Play Count Stat Pill */}
                      <div className="flex items-center space-x-4 shrink-0 pl-4">
                        <div className="text-right">
                          <div className="flex items-center space-x-1.5 justify-end">
                            <Play size={12} className="text-accent fill-accent" />
                            <span className="text-sm font-black text-accent">{playCount}</span>
                            <span className="text-[10px] text-gray-500">plays</span>
                          </div>
                          <div className="text-[9px] text-gray-500">
                            {Math.round((playCount * item.runtime) / 3600)} hrs on-air
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2 py-12">
                  <Tv size={32} className="text-gray-700" />
                  <p className="text-xs">No media playback frequency recorded yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "telemetry" && (
          <div className="flex-1 bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-y-auto space-y-4">
            {/* OVERALL HEALTH RATING BAR */}
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
              <div className="space-y-1.5 flex-1 pr-6">
                <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                  TOTAL BROADCAST STATION METADATA INDEX
                </div>
                <div className="flex items-center space-x-4">
                  <div className="w-full h-3 bg-gray-900 rounded-full overflow-hidden border border-gray-800 relative">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        overallHealth > 85 ? "bg-accent cyan-glow" : overallHealth > 60 ? "bg-amber-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${overallHealth}%` }}
                    />
                  </div>
                  <span className={`text-xl font-black ${
                    overallHealth > 85 ? "text-accent" : overallHealth > 60 ? "text-amber-500" : "text-rose-500"
                  }`}>{overallHealth}%</span>
                </div>
              </div>
            </div>

            {/* METRIC GAUGES GRID */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {[
                { label: "POSTERS INTACT", percent: posterPercent, count: report?.missing_posters_count },
                { label: "BACKDROPS INTACT", percent: backdropPercent, count: report?.missing_backdrops_count },
                { label: "SYNOPSIS COVERED", percent: synopsisPercent, count: report?.missing_synopsis_count },
                { label: "ENGLISH SUBTITLES", percent: enSubsPercent, count: report?.missing_english_subs_count },
                { label: "FRENCH SUBTITLES", percent: frSubsPercent, count: report?.missing_french_subs_count },
              ].map((metric, i) => (
                <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg p-3.5 space-y-2.5">
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{metric.label}</div>
                  
                  <div className="flex justify-between items-end">
                    <div className="text-2xl font-black text-gray-100">{metric.percent}%</div>
                    <div className="text-[10px] text-gray-500 font-bold mb-0.5">
                      {metric.count} MISSING
                    </div>
                  </div>

                  <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${metric.percent > 85 ? "bg-emerald-500" : metric.percent > 60 ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${metric.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "integrity" && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden">
            {/* Duplicate Files list */}
            <div className="bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-hidden">
              <div className="text-xs text-gray-400 font-bold mb-2.5 flex items-center space-x-1.5 pb-2 border-b border-gray-800 shrink-0">
                <FileWarning size={14} className="text-amber-500" />
                <span>DUPLICATE CHECKSUMS (EXACT IDENTICAL MEDIA)</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
                {report?.duplicate_files && report.duplicate_files.length > 0 ? (
                  report.duplicate_files.map((path, idx) => (
                    <div 
                      key={idx} 
                      className="p-2.5 bg-gray-950 border border-gray-800 rounded text-[11px] text-gray-300 break-all leading-normal hover:border-amber-500/40"
                    >
                      {path}
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-xs">
                    No duplicate checksums detected in media folders.
                  </div>
                )}
              </div>
            </div>

            {/* Duplicate Metadata list */}
            <div className="bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-hidden">
              <div className="text-xs text-gray-400 font-bold mb-2.5 flex items-center space-x-1.5 pb-2 border-b border-gray-800 shrink-0">
                <Copy size={14} className="text-amber-500" />
                <span>DUPLICATE TITLE CARDS</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
                {report?.duplicate_metadata && report.duplicate_metadata.length > 0 ? (
                  report.duplicate_metadata.map((title, idx) => (
                    <div 
                      key={idx} 
                      className="p-2.5 bg-gray-950 border border-gray-800 rounded text-[11px] text-gray-300 font-bold hover:border-amber-500/40 flex justify-between items-center"
                    >
                      <span>{title}</span>
                      <span className="text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono uppercase">
                        RESOLVE REQD
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-xs">
                    No duplicate title cards detected in SQLite index.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="mt-3 pt-3 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between shrink-0">
        <span>TOTAL MONITORED ITEMS: {items.length} INDEX NODES</span>
        <span className="text-accent font-bold">STATION STATS TELEMETRY: ACTIVE</span>
      </div>
    </div>
  );
};

