import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDiagnosticsStore, useLibraryStore } from "../store";
import { BarChart3, RefreshCw, FileWarning, Copy, Play, Film, Clock, Award, ShieldCheck, Flame, Tv, History } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";


export const Health: React.FC = () => {
  const { report, isLoading, fetchReport } = useDiagnosticsStore();
  const { items, fetchItems } = useLibraryStore();
  const [activeTab, setActiveTab] = useState<"plays" | "telemetry" | "integrity" | "history" | "heatmap">("plays");
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  const fetchHeatmap = async () => {
    setHeatmapLoading(true);
    try {
      const data = await invoke<any[]>("get_genre_heatmap");
      setHeatmapData(data);
    } catch (e) {
      console.error("Failed to fetch genre heatmap:", e);
    } finally {
      setHeatmapLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const entries = await invoke<any[]>("get_playback_history", { limit: 200 });
      setHistoryEntries(entries);
    } catch (e) {
      console.error("Failed to fetch playback history:", e);
    } finally {
      setHistoryLoading(false);
    }
  };


  useEffect(() => {
    fetchReport();
    fetchItems();
    fetchHistory();
    fetchHeatmap();
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
              <button
                onClick={() => { setActiveTab("history"); fetchHistory(); }}
                className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                  activeTab === "history" ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                AIR HISTORY
              </button>
              <button
                onClick={() => { setActiveTab("heatmap"); fetchHeatmap(); }}
                className={`px-3 py-1 rounded text-[11px] font-bold transition-all ${
                  activeTab === "heatmap" ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                GENRE HEATMAP
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

        {activeTab === "history" && (
          <div className="flex-1 bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-800 shrink-0">
              <div className="flex items-center space-x-2 text-xs font-bold text-gray-300">
                <History size={16} className="text-accent" />
                <span>ON-AIR BROADCAST HISTORY TIMELINE</span>
              </div>
              <div className="text-[10px] text-gray-500 font-bold">
                LAST {historyEntries.length} AIRINGS · NEWEST FIRST
              </div>
            </div>

            {historyLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
                <RefreshCw size={14} className="animate-spin mr-2 text-accent" />
                Loading broadcast history...
              </div>
            ) : historyEntries.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600 space-y-2">
                <Tv size={32} className="text-gray-700" />
                <p className="text-xs">No broadcast history recorded yet.</p>
                <p className="text-[10px] text-gray-600 text-center max-w-xs leading-relaxed">
                  History is recorded after 60+ seconds of confirmed playback on the On Air monitor.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
                {historyEntries.map((entry, idx) => {
                  const posterUrl = entry.poster_path
                    ? entry.poster_path.startsWith("http")
                      ? entry.poster_path
                      : convertFileSrc(entry.poster_path)
                    : null;
                  
                  const airedDate = (() => {
                    try {
                      const d = new Date(entry.aired_at);
                      return {
                        date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
                        time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
                      };
                    } catch {
                      return { date: "—", time: "—" };
                    }
                  })();

                  const durationMin = Math.round(entry.duration_aired / 60);

                  return (
                    <div
                      key={entry.id || idx}
                      className="p-2.5 bg-gray-950/80 border border-gray-800/80 rounded-lg hover:border-accent/30 flex items-center space-x-3 transition-all group"
                    >
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center shrink-0 w-6">
                        <div className="w-2 h-2 rounded-full bg-accent/70 group-hover:bg-accent transition-colors" />
                        {idx < historyEntries.length - 1 && <div className="w-px flex-1 bg-gray-800 mt-1 h-4" />}
                      </div>

                      {/* Poster */}
                      <div className="w-8 h-11 bg-gray-900 rounded overflow-hidden shrink-0 border border-gray-800">
                        {posterUrl ? (
                          <img src={posterUrl} alt={entry.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film size={12} className="text-gray-600" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-200 truncate group-hover:text-accent transition-colors">
                          {entry.title}
                        </div>
                        <div className="flex items-center space-x-2 text-[9px] text-gray-500 mt-0.5">
                          <span className="bg-gray-900 border border-gray-800 px-1 py-0.5 rounded uppercase font-bold text-[8px]">{entry.media_type}</span>
                          {entry.year && <span>{entry.year}</span>}
                          <span>•</span>
                          <span className="text-cyan-500/70">{entry.channel_name}</span>
                        </div>
                      </div>

                      {/* Timestamp + duration */}
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold text-gray-400">{airedDate.time}</div>
                        <div className="text-[9px] text-gray-600">{airedDate.date}</div>
                        {durationMin > 0 && (
                          <div className="text-[8px] text-accent/70 mt-0.5">{durationMin}m aired</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* GENRE HEATMAP TAB */}
        {activeTab === "heatmap" && (
          <div className="flex-1 bg-panel border border-gray-800 rounded-lg p-4 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-800 shrink-0">
              <div className="flex items-center space-x-2 text-xs font-bold text-gray-300">
                <BarChart3 size={16} className="text-accent" />
                <span>GENRE AFFINITY HEATMAP — AIRINGS BY DAY OF WEEK</span>
              </div>
              <div className="flex items-center space-x-3">
                {/* Legend */}
                <div className="flex items-center space-x-1.5 text-[9px] text-gray-500">
                  <span>FEWER</span>
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map(o => (
                    <div key={o} className="w-4 h-4 rounded-sm border border-cyan-400/20"
                      style={{ backgroundColor: `rgba(6,182,212,${o})` }} />
                  ))}
                  <span>MORE</span>
                </div>
                <button onClick={fetchHeatmap} disabled={heatmapLoading}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs rounded px-2 py-1 border border-gray-700 flex items-center space-x-1 transition-colors">
                  <RefreshCw size={11} className={heatmapLoading ? "animate-spin" : ""} />
                  <span>REFRESH</span>
                </button>
              </div>
            </div>

            {heatmapLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
                <RefreshCw size={18} className="animate-spin mr-2 text-accent" />
                Loading genre data...
              </div>
            ) : heatmapData.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600 space-y-2">
                <BarChart3 size={36} className="text-gray-800" />
                <p className="text-xs font-bold">NO PLAYBACK HISTORY YET</p>
                <p className="text-[10px] text-gray-600 max-w-xs text-center leading-relaxed">
                  Heatmap data builds as content airs. Start broadcasting and this chart will populate over time.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                {/* Day headers */}
                <div className="grid gap-1 mb-2 sticky top-0 bg-panel z-10 pb-1"
                  style={{ gridTemplateColumns: "180px repeat(7, 1fr) 60px" }}>
                  <div className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">GENRE</div>
                  {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(d => (
                    <div key={d} className="text-[9px] text-gray-500 font-bold text-center uppercase tracking-wider">{d}</div>
                  ))}
                  <div className="text-[9px] text-gray-500 font-bold text-center uppercase tracking-wider">TOTAL</div>
                </div>

                {/* Genre rows */}
                {(() => {
                  const maxVal = Math.max(1, ...heatmapData.flatMap(r =>
                    [r.mon, r.tue, r.wed, r.thu, r.fri, r.sat, r.sun]
                  ));
                  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
                  return heatmapData.map((row) => (
                    <div key={row.genre} className="grid gap-1 mb-1 group"
                      style={{ gridTemplateColumns: "180px repeat(7, 1fr) 60px" }}>
                      <div className="text-[10px] text-gray-300 font-bold truncate flex items-center pr-2
                        group-hover:text-accent transition-colors" title={row.genre}>
                        {row.genre}
                      </div>
                      {days.map(day => {
                        const val: number = row[day] || 0;
                        const intensity = val === 0 ? 0 : 0.08 + (val / maxVal) * 0.82;
                        return (
                          <div key={day}
                            className="relative h-8 rounded border border-cyan-400/10 flex items-center justify-center text-[9px] font-bold transition-all hover:border-accent/40"
                            style={{ backgroundColor: val === 0 ? "rgba(17,24,39,0.5)" : `rgba(6,182,212,${intensity})` }}
                            title={`${row.genre} · ${day.toUpperCase()}: ${val} airing${val !== 1 ? "s" : ""}`}>
                            <span className={val === 0 ? "text-gray-700" : intensity > 0.5 ? "text-gray-900" : "text-cyan-200"}>
                              {val === 0 ? "·" : val}
                            </span>
                          </div>
                        );
                      })}
                      <div className="h-8 rounded border border-gray-700/50 flex items-center justify-center text-[10px] font-bold text-accent bg-accent/5">
                        {row.total}
                      </div>
                    </div>
                  ));
                })()}

                {/* Column totals */}
                {heatmapData.length > 0 && (() => {
                  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
                  const totals = days.map(d => heatmapData.reduce((s, r) => s + (r[d] || 0), 0));
                  const grand = totals.reduce((a, b) => a + b, 0);
                  return (
                    <div className="grid gap-1 mt-2 pt-2 border-t border-gray-800"
                      style={{ gridTemplateColumns: "180px repeat(7, 1fr) 60px" }}>
                      <div className="text-[9px] text-gray-500 font-bold uppercase tracking-wider flex items-center">TOTAL</div>
                      {totals.map((t, i) => (
                        <div key={i} className="h-7 rounded border border-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300 bg-gray-900/50">
                          {t}
                        </div>
                      ))}
                      <div className="h-7 rounded border border-accent/30 flex items-center justify-center text-[10px] font-bold text-accent bg-accent/5">
                        {grand}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
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

