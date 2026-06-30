import React, { useEffect } from "react";
import { useDiagnosticsStore, useLibraryStore } from "../store";
import { Activity, RefreshCw, FileWarning, Copy } from "lucide-react";

export const Health: React.FC = () => {
  const { report, isLoading, fetchReport } = useDiagnosticsStore();
  const { items, fetchItems } = useLibraryStore();

  useEffect(() => {
    fetchReport();
    fetchItems();
  }, [fetchReport, fetchItems]);

  const totalItems = items.length || 1; // avoid divide by zero

  // Calculate percentages
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
      {/* HEADER CONTROLS */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
            <Activity size={16} />
            <span>COLLECTION QUALITY & TELEMETRY SYSTEM</span>
          </span>
          <button
            onClick={fetchReport}
            disabled={isLoading}
            className="bg-accent text-background font-bold text-xs rounded px-4 py-1.5 hover:bg-cyan-400 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
            <span>RE-RUN DIAGNOSTICS</span>
          </button>
        </div>
      </div>

      {/* OVERALL HEALTH RATING BAR */}
      <div className="bg-panel border border-gray-800 rounded-lg p-5 mt-4 flex items-center justify-between">
        <div className="space-y-1.5 flex-1">
          <div className="text-xs text-gray-400 font-bold">TOTAL BROADCAST STATION QUALITY INDEX</div>
          <div className="flex items-center space-x-4">
            <div className="w-full h-3 bg-gray-950 rounded-full overflow-hidden border border-gray-800 relative">
              <div 
                className={`h-full transition-all duration-500 ${
                  overallHealth > 85 ? "bg-accent cyan-glow" : overallHealth > 60 ? "bg-amber-500" : "bg-rose-500"
                }`}
                style={{ width: `${overallHealth}%` }}
              />
            </div>
            <span className={`text-xl font-extrabold ${
              overallHealth > 85 ? "text-accent" : overallHealth > 60 ? "text-amber-500" : "text-rose-500"
            }`}>{overallHealth}%</span>
          </div>
        </div>
      </div>

      {/* METRIC GAUGES GRID */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-4">
        {[
          { label: "POSTERS INTACT", percent: posterPercent, count: report?.missing_posters_count },
          { label: "BACKDROPS INTACT", percent: backdropPercent, count: report?.missing_backdrops_count },
          { label: "SYNOPSIS COVERED", percent: synopsisPercent, count: report?.missing_synopsis_count },
          { label: "ENGLISH SUBTITLES", percent: enSubsPercent, count: report?.missing_english_subs_count },
          { label: "FRENCH SUBTITLES", percent: frSubsPercent, count: report?.missing_french_subs_count },
        ].map((metric, i) => (
          <div key={i} className="bg-panel border border-gray-800 rounded-lg p-4 space-y-3 relative overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{metric.label}</div>
            
            <div className="flex justify-between items-end">
              <div className="text-2xl font-extrabold text-gray-100">{metric.percent}%</div>
              <div className="text-[10px] text-gray-500 font-bold mb-1">
                {metric.count} MISSING
              </div>
            </div>

            {/* Micro loading bar */}
            <div className="w-full h-1 bg-gray-950 rounded-full overflow-hidden">
              <div 
                className={`h-full ${metric.percent > 85 ? "bg-emerald-500" : metric.percent > 60 ? "bg-amber-500" : "bg-rose-500"}`}
                style={{ width: `${metric.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* REPORT SCROLLABLE ROW DETAILS */}
      <div className="flex-1 mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden">
        {/* Left Col: Duplicate Files list */}
        <div className="bg-panel border border-gray-800 rounded-lg p-5 flex flex-col overflow-hidden">
          <div className="text-xs text-gray-400 font-bold mb-3 flex items-center space-x-1.5">
            <FileWarning size={14} className="text-amber-500" />
            <span>DUPLICATE FILE REPOSITORIES (MATCHING CHECKSUMS)</span>
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

        {/* Right Col: Duplicate Metadata list */}
        <div className="bg-panel border border-gray-800 rounded-lg p-5 flex flex-col overflow-hidden">
          <div className="text-xs text-gray-400 font-bold mb-3 flex items-center space-x-1.5">
            <Copy size={14} className="text-amber-500" />
            <span>DUPLICATE METADATA ENTRIES (MATCHING TITLES)</span>
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
                No duplicate title cards detected in sqlite index.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="mt-4 pt-4 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between">
        <span>TOTAL MONITORED ITEMS: {items.length} INDEX NODES</span>
        <span className="text-accent">DIAGNOSTICS SYSTEM STATUS: PASS</span>
      </div>
    </div>
  );
};
