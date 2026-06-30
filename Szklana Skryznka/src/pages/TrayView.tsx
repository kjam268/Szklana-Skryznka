import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TrayStats {
  totalCount: number;
  avgQuality: number;
  notFoundCount: number;
}

export function TrayView() {
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [scanFile, setScanFile] = useState<string>("");
  const [visualProgress, setVisualProgress] = useState<number | null>(null);
  const [visualFile, setVisualFile] = useState<string>("");
  const [stats, setStats] = useState<TrayStats>({ totalCount: 0, avgQuality: 0, notFoundCount: 0 });

  const fetchStats = async () => {
    try {
      const items = await invoke<any[]>("get_media");
      const totalCount = items.length;
      
      let sumQuality = 0;
      let ratedCount = 0;
      let notFoundCount = 0;

      items.forEach((details: any) => {
        // Average Quality Score
        const file = details.files?.[0];
        if (file && file.quality_score) {
          sumQuality += file.quality_score;
          ratedCount++;
        }
        
        // Not Found Count: no remote poster
        const poster = details.item?.poster_path;
        const hasPoster = poster && (poster.startsWith("http://") || poster.startsWith("https://"));
        if (!hasPoster) {
          notFoundCount++;
        }
      });

      const avgQuality = ratedCount > 0 ? Math.round(sumQuality / ratedCount) : 0;
      setStats({ totalCount, avgQuality, notFoundCount });
    } catch (e) {
      console.error("Failed to load stats for tray view:", e);
    }
  };

  useEffect(() => {
    fetchStats();

    // Listen to directory scan progress
    const unlistenScanProg = listen<number>("scan-progress", (event) => {
      setScanProgress(event.payload);
      if (event.payload === 100) {
        setTimeout(() => {
          setScanProgress(null);
          setScanFile("");
          fetchStats();
        }, 3000);
      }
    });

    const unlistenScanFile = listen<string>("scan-file", (event) => {
      setScanFile(event.payload);
      setScanProgress((prev) => prev ?? 0);
    });

    // Listen to background visual checks progress
    const unlistenVisual = listen<{ filename: string; progress: number }>("visual-progress", (event) => {
      setVisualFile(event.payload.filename);
      setVisualProgress(event.payload.progress);
      if (event.payload.progress === 100) {
        setTimeout(() => {
          setVisualProgress(null);
          setVisualFile("");
          fetchStats();
        }, 3000);
      }
    });

    // Refresh stats when library updates
    const unlistenLib = listen("library-updated", () => {
      fetchStats();
    });

    return () => {
      unlistenScanProg.then((f) => f());
      unlistenScanFile.then((f) => f());
      unlistenVisual.then((f) => f());
      unlistenLib.then((f) => f());
    };
  }, []);

  const handleOpenApp = async () => {
    try {
      await invoke("open_app_window");
    } catch (e) {
      console.error(e);
    }
  };

  const handleQuit = async () => {
    try {
      await invoke("quit_app");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="w-screen h-screen bg-[#070b19]/95 text-gray-200 p-4 font-mono flex flex-col justify-between border border-accent/20 select-none overflow-hidden rounded-lg shadow-2xl">
      {/* HEADER SECTION */}
      <div className="flex items-center space-x-2 border-b border-gray-800/60 pb-3">
        <img 
          src="/app-icon.png" 
          alt="App Icon" 
          className="w-7 h-7 aspect-square object-contain" 
        />
        <div>
          <h1 className="text-xs font-bold text-accent tracking-widest">SZKLANA SKRZYNKA</h1>
          <p className="text-[9px] text-gray-400">System Dashboard Panel</p>
        </div>
      </div>

      {/* BODY / PROGRESS SECTION */}
      <div className="flex-1 my-3 flex flex-col justify-center space-y-3">
        {scanProgress !== null ? (
          /* SCANNING/IMPORTING FEEDBACK */
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded p-2.5 space-y-2">
            <div className="flex justify-between text-[10px] font-bold text-cyan-400">
              <span className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping mr-1"></span>
                IMPORTING COLLECTION
              </span>
              <span>{scanProgress}%</span>
            </div>
            <p className="text-[9px] text-gray-300 truncate font-mono">
              File: {scanFile || "Scanning directories..."}
            </p>
            <div className="w-full bg-gray-900 rounded-full h-1 overflow-hidden border border-gray-800">
              <div 
                className="bg-cyan-400 h-1 transition-all duration-300" 
                style={{ width: `${scanProgress}%` }}
              ></div>
            </div>
          </div>
        ) : visualProgress !== null ? (
          /* DEEP DECODED VISUAL QUALITY CHECK FEEDBACK */
          <div className="bg-amber-500/5 border border-amber-500/20 rounded p-2.5 space-y-2">
            <div className="flex justify-between text-[10px] font-bold text-amber-500">
              <span className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1"></span>
                👑 DEEP VISUAL CHECK
              </span>
              <span>{visualProgress}%</span>
            </div>
            <p className="text-[9px] text-gray-300 truncate font-mono">
              File: {visualFile}
            </p>
            <div className="w-full bg-gray-900 rounded-full h-1 overflow-hidden border border-gray-800">
              <div 
                className="bg-amber-500 h-1 transition-all duration-300" 
                style={{ width: `${visualProgress}%` }}
              ></div>
            </div>
          </div>
        ) : (
          /* IDLE STATS PANEL */
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-panel border border-gray-800/60 rounded p-2 text-center">
              <p className="text-[8px] text-gray-400 font-bold">TOTAL ASSETS</p>
              <p className="text-sm font-bold text-accent mt-0.5">{stats.totalCount}</p>
            </div>
            <div className="bg-panel border border-gray-800/60 rounded p-2 text-center">
              <p className="text-[8px] text-gray-400 font-bold">AVG QUALITY</p>
              <p className="text-sm font-bold text-amber-400 mt-0.5">{stats.avgQuality}%</p>
            </div>
            <div className="bg-panel border border-gray-800/60 rounded p-2 text-center">
              <p className="text-[8px] text-gray-400 font-bold">UNRESOLVED</p>
              <p className="text-sm font-bold text-rose-500 mt-0.5">{stats.notFoundCount}</p>
            </div>
          </div>
        )}

        {/* SYSTEM STATUS LABELS */}
        <div className="flex justify-between items-center text-[9px] px-1">
          <span className="text-gray-400">Background Worker:</span>
          {scanProgress !== null || visualProgress !== null ? (
            <span className="text-amber-500 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping mr-1"></span>
              Active
            </span>
          ) : (
            <span className="text-emerald-500 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
              Idle / Synced
            </span>
          )}
        </div>
      </div>

      {/* FOOTER ACTION BUTTONS */}
      <div className="border-t border-gray-800/60 pt-3 flex space-x-2">
        <button
          onClick={handleOpenApp}
          className="flex-1 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-[10px] font-bold py-2 rounded font-mono transition-all duration-200 active:scale-98"
        >
          OPEN MAIN APP
        </button>
        <button
          onClick={handleQuit}
          className="bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-500 text-[10px] font-bold px-4 py-2 rounded font-mono transition-all duration-200 active:scale-98"
        >
          QUIT
        </button>
      </div>
    </div>
  );
}
