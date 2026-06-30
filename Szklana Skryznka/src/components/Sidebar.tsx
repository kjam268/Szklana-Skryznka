import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Tv, Film, CalendarDays, Database, Activity, Lightbulb, 
  ChevronLeft, Settings
} from "lucide-react";
import { useLibraryStore, useScheduleStore, useChannelStore } from "../store";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState("");
  const [tempAnilistKey, setTempAnilistKey] = useState("");
  const [tempOpensubtitlesKey, setTempOpensubtitlesKey] = useState("");
  const [tempOmdbKey, setTempOmdbKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [tmdbStatus, setTmdbStatus] = useState<"checking" | "connected" | "disconnected" | "none">("checking");
  const [omdbStatus, setOmdbStatus] = useState<"checking" | "connected" | "disconnected" | "none">("checking");

  const [purgeTarget, setPurgeTarget] = useState<"library" | "schedule" | "all_keep_settings" | "all">("library");
  const [purgePassword, setPurgePassword] = useState("");
  const [isPurging, setIsPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState("");
  const [modalTab, setModalTab] = useState<"api_key" | "purges">("api_key");

  useEffect(() => {
    let unlistenPurge: any;
    let unlistenKey: any;
    const setupMenuListeners = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenPurge = await listen("menu-purge-database", () => {
          handleOpenModal();
        });
        unlistenKey = await listen("menu-set-api-key", () => {
          handleOpenModal();
        });
      } catch (e) {
        console.error("Failed to setup menu listeners:", e);
      }
    };
    setupMenuListeners();
    return () => {
      if (unlistenPurge) unlistenPurge();
      if (unlistenKey) unlistenKey();
    };
  }, []);

  const checkConnection = async () => {
    setTmdbStatus("checking");
    try {
      const key = await invoke<string | null>("get_setting", { key: "tmdb_api_key" });
      if (!key || key.trim() === "") {
        setTmdbStatus("none");
        return;
      }
      const key_trimmed = key.trim();
      let url = "";
      let headers: HeadersInit = {};
      if (key_trimmed.length > 45) {
        url = `https://api.themoviedb.org/3/configuration`;
        headers = { "Authorization": `Bearer ${key_trimmed}` };
      } else {
        url = `https://api.themoviedb.org/3/configuration?api_key=${key_trimmed}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        setTmdbStatus("connected");
      } else {
        setTmdbStatus("disconnected");
      }
    } catch (e) {
      console.error(e);
      setTmdbStatus("disconnected");
    }
  };

  const checkOmdbConnection = async () => {
    setOmdbStatus("checking");
    try {
      const key = await invoke<string | null>("get_setting", { key: "omdb_api_key" });
      if (!key || key.trim() === "") {
        setOmdbStatus("none");
        return;
      }
      const key_trimmed = key.trim();
      const res = await fetch(`https://www.omdbapi.com/?apikey=${key_trimmed}&t=Inception`);
      if (res.ok) {
        const data = await res.json();
        if (data.Response === "True") {
          setOmdbStatus("connected");
        } else {
          setOmdbStatus("disconnected");
        }
      } else {
        setOmdbStatus("disconnected");
      }
    } catch (e) {
      console.error(e);
      setOmdbStatus("disconnected");
    }
  };

  useEffect(() => {
    checkConnection();
    checkOmdbConnection();
  }, [showKeyModal]);

  const menuItems = [
    { id: "onair", label: "Szklana Skryznka", icon: Tv, highlight: true },
    { id: "library", label: "The Library", icon: Film },
    { id: "grid", label: "The Grid", icon: CalendarDays },
    { id: "database", label: "Database Viewer", icon: Database },
    { id: "health", label: "Health & Integrity", icon: Activity },
    { id: "suggestions", label: "Smart Suggestions", icon: Lightbulb },
  ];

  const handleOpenModal = async () => {
    try {
      const existingKey = await invoke<string | null>("get_setting", { key: "tmdb_api_key" });
      setTempKey(existingKey || "");
      const existingAnilistKey = await invoke<string | null>("get_setting", { key: "anilist_api_key" });
      setTempAnilistKey(existingAnilistKey || "");
      const existingOpensubtitlesKey = await invoke<string | null>("get_setting", { key: "opensubtitles_api_key" });
      setTempOpensubtitlesKey(existingOpensubtitlesKey || "");
      const existingOmdbKey = await invoke<string | null>("get_setting", { key: "omdb_api_key" });
      setTempOmdbKey(existingOmdbKey || "");
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
    setShowKeyModal(true);
  };

  const handleSaveKey = async () => {
    setIsSaving(true);
    setSaveMessage("Saving configurations...");
    try {
      const key_trimmed = tempKey.trim();
      const anilist_trimmed = tempAnilistKey.trim();
      const opensubtitles_trimmed = tempOpensubtitlesKey.trim();
      const omdb_trimmed = tempOmdbKey.trim();
      await invoke("set_setting", { key: "tmdb_api_key", value: key_trimmed });
      await invoke("set_setting", { key: "anilist_api_key", value: anilist_trimmed });
      await invoke("set_setting", { key: "opensubtitles_api_key", value: opensubtitles_trimmed });
      await invoke("set_setting", { key: "omdb_api_key", value: omdb_trimmed });
      setTmdbStatus("checking");
      setOmdbStatus("checking");
      
      if (key_trimmed === "") {
        setTmdbStatus("none");
        setSaveMessage("Settings saved successfully.");
      } else {
        let url = "";
        let headers: HeadersInit = {};
        if (key_trimmed.length > 45) {
          url = `https://api.themoviedb.org/3/configuration`;
          headers = { "Authorization": `Bearer ${key_trimmed}` };
        } else {
          url = `https://api.themoviedb.org/3/configuration?api_key=${key_trimmed}`;
        }
        const res = await fetch(url, { headers });
        if (res.ok) {
          setTmdbStatus("connected");
          setSaveMessage("Settings saved and TMDb connected successfully!");
        } else {
          setTmdbStatus("disconnected");
          setSaveMessage("Settings saved, but TMDb failed (invalid API key).");
        }
      }

      if (omdb_trimmed === "") {
        setOmdbStatus("none");
      } else {
        const res = await fetch(`https://www.omdbapi.com/?apikey=${omdb_trimmed}&t=Inception`);
        if (res.ok) {
          const data = await res.json();
          if (data.Response === "True") {
            setOmdbStatus("connected");
          } else {
            setOmdbStatus("disconnected");
          }
        } else {
          setOmdbStatus("disconnected");
        }
      }
    } catch (e) {
      setSaveMessage(`Error: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <aside 
        onMouseEnter={() => setIsCollapsed(false)}
        onMouseLeave={() => setIsCollapsed(true)}
        className={`absolute left-0 top-0 h-screen bg-panel/80 backdrop-blur-md border-r border-gray-800 flex flex-col justify-between transition-all duration-300 z-30 ${
          isCollapsed ? "w-16 shadow-none" : "w-64 shadow-[10px_0_30px_rgba(0,0,0,0.6)]"
        }`}
      >
        <div>
          {/* Header Branding */}
          <div className="flex items-center p-4 border-b border-gray-800 justify-between overflow-hidden">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center focus:outline-none text-left group transition-all"
              title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              <img 
                src="/app-icon.png" 
                alt="App Icon" 
                className="w-[30px] h-[30px] flex-shrink-0 rounded drop-shadow-[0_0_8px_rgba(6,182,212,0.4)] aspect-square object-contain hover:scale-[1.05] transition-transform" 
              />
              <span className={`font-mono text-xs tracking-widest font-bold text-gray-200 group-hover:text-accent transition-all duration-300 origin-left overflow-hidden whitespace-nowrap ${
                isCollapsed ? "w-0 opacity-0 ml-0" : "w-auto opacity-100 ml-2.5"
              }`}>
                SZKLANA SKRYZNKA
              </span>
            </button>
            
            <div className={`transition-all duration-300 origin-right overflow-hidden ${
              isCollapsed ? "w-0 opacity-0 pointer-events-none" : "w-auto opacity-100 ml-2"
            }`}>
              <button 
                onClick={() => setIsCollapsed(true)}
                className="text-gray-400 hover:text-accent focus:outline-none p-1 rounded hover:bg-gray-800 transition-colors"
                title="Collapse"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="mt-4 px-2 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center rounded-lg p-3 text-sm font-mono transition-all duration-200 ${
                    isActive 
                      ? item.highlight 
                        ? "bg-onair/10 text-onair border-l-4 border-onair font-bold orange-glow" 
                        : "bg-accent/10 text-accent border-l-4 border-accent font-bold cyan-glow"
                      : "text-gray-400 hover:text-gray-100 hover:bg-gray-800 border-l-4 border-transparent"
                  }`}
                >
                  <div className="flex items-center space-x-3 w-full overflow-hidden">
                    <Icon size={18} className={`flex-shrink-0 ${isActive ? (item.highlight ? "text-onair" : "text-accent") : "text-gray-400"}`} />
                    <div className={`flex justify-between items-center w-full transition-all duration-300 origin-left ${
                      isCollapsed ? "opacity-0 scale-x-0 w-0 pointer-events-none" : "opacity-100 scale-x-100 w-auto"
                    }`}>
                      <span className="whitespace-nowrap">{item.label}</span>
                      {item.highlight && (
                        <span className="text-[9px] bg-onair/20 text-onair px-1.5 py-0.5 rounded font-sans tracking-wide animate-pulse flex-shrink-0">
                          ON AIR
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / System status */}
        <div className="p-4 border-t border-gray-800 text-[10px] font-mono text-gray-500 space-y-3">
          <div className={`transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-h-0 pointer-events-none" : "opacity-100 max-h-20"}`}>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>SYS STATUS:</span>
                <span className="text-accent font-bold">ONLINE</span>
              </div>
              <div className="flex justify-between">
                <span>DB SYNC:</span>
                <span className="text-emerald-500 font-bold">STABLE</span>
              </div>
            </div>
          </div>

          <div className={`flex items-center justify-between transition-all duration-300 ${isCollapsed ? "justify-center space-y-2 flex-col" : "flex-row"}`}>
            <span className="flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                tmdbStatus === "connected" ? "bg-emerald-500 cyan-glow" :
                tmdbStatus === "disconnected" ? "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                tmdbStatus === "checking" ? "bg-amber-500 animate-pulse" : "bg-gray-700"
              }`} title={`TMDb API Status: ${tmdbStatus.toUpperCase()}`} />
              <span className={`transition-all duration-300 origin-left overflow-hidden ${
                isCollapsed ? "opacity-0 w-0 scale-x-0" : "opacity-100 w-auto scale-x-100"
              }`}>
                <span className="font-bold whitespace-nowrap">TMDB</span>
              </span>
            </span>

            <button 
              onClick={handleOpenModal}
              title="Settings & Configurations"
              className="text-gray-400 hover:text-accent p-1.5 rounded hover:bg-gray-800 transition-all focus:outline-none flex items-center space-x-1"
            >
              <Settings size={16} className="hover:rotate-45 transition-transform duration-300 flex-shrink-0" />
              <span className={`text-[9px] font-bold transition-all duration-300 origin-left overflow-hidden whitespace-nowrap ${
                isCollapsed ? "opacity-0 w-0 scale-x-0" : "opacity-100 w-auto scale-x-100"
              }`}>
                SETTINGS
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* Retro-styled Settings Modal with Tabbed Interface */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 select-none font-mono">
          <div className="bg-panel border border-accent/40 shadow-[0_0_20px_rgba(6,182,212,0.25)] rounded-lg p-6 max-w-xl w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-800 pb-2.5">
              <span className="text-xs font-bold text-accent tracking-widest flex items-center space-x-1.5">
                <Settings size={14} className="animate-pulse text-accent" />
                <span>SETTINGS & CONFIGURATION</span>
              </span>
              <button 
                onClick={() => {
                  setShowKeyModal(false);
                  setConfirmPurge(false);
                  setPurgeFeedback("");
                  setPurgePassword("");
                }}
                className="text-gray-500 hover:text-gray-300 text-xs font-bold focus:outline-none"
              >
                CLOSE
              </button>
            </div>

            {/* Split layout: left sidebar tabs, right panel */}
            <div className="flex space-x-4 min-h-[280px]">
              {/* Left Tabs */}
              <div className="w-1/4 flex flex-col space-y-2 border-r border-gray-800 pr-4 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    setModalTab("api_key");
                    setConfirmPurge(false);
                    setPurgeFeedback("");
                    setPurgePassword("");
                  }}
                  className={`text-left p-2 rounded transition-all font-mono tracking-wider font-bold ${
                    modalTab === "api_key" 
                      ? "bg-accent/15 text-accent border border-accent/30" 
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-transparent"
                  }`}
                >
                  API KEY
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalTab("purges");
                    setConfirmPurge(false);
                    setPurgeFeedback("");
                    setPurgePassword("");
                  }}
                  className={`text-left p-2 rounded transition-all font-mono tracking-wider font-bold ${
                    modalTab === "purges" 
                      ? "bg-rose-500/15 text-rose-500 border border-rose-500/30" 
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-transparent"
                  }`}
                >
                  PURGES
                </button>
              </div>

              {/* Right Content */}
              <div className="w-3/4 flex flex-col justify-between">
                {modalTab === "api_key" ? (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-4 max-h-[220px] overflow-y-auto pr-1">
                      
                      {/* TMDb Section */}
                      <div className="space-y-2 border-b border-gray-850 pb-3">
                        <span className="text-[10px] text-accent font-bold tracking-wider block">TMDb API Connection</span>
                        <p className="text-[9px] text-gray-400 leading-normal font-mono">
                          Provide your personal TMDb API v3 key or v4 Bearer token to enable automatic poster graphics and plot summaries scanning from online records.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[8px] text-gray-500 tracking-widest uppercase font-bold">API KEY / TOKEN</label>
                          <input
                            type="password"
                            placeholder="Enter TMDb API key..."
                            value={tempKey}
                            onChange={(e) => setTempKey(e.target.value)}
                            disabled={isSaving}
                            className="w-full bg-gray-950 border border-gray-850 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-bold font-mono placeholder-gray-700 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {/* Japanese Animation (AniList) Section */}
                      <div className="space-y-2">
                        <span className="text-[10px] text-accent font-bold tracking-wider block">Japanese Animation (AniList)</span>
                        <p className="text-[9px] text-gray-400 leading-normal font-mono">
                          Provide your AniList API Client Access Token to search, verify, and tag Japanese Animation (Anime) entries.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[8px] text-gray-500 tracking-widest uppercase font-bold">ANILIST API KEY</label>
                          <input
                            type="password"
                            placeholder="Enter AniList access token..."
                            value={tempAnilistKey}
                            onChange={(e) => setTempAnilistKey(e.target.value)}
                            disabled={isSaving}
                            className="w-full bg-gray-950 border border-gray-855 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-bold font-mono placeholder-gray-700 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {/* OpenSubtitles Section */}
                      <div className="space-y-2">
                        <span className="text-[10px] text-accent font-bold tracking-wider block">OpenSubtitles Subtitles Search</span>
                        <p className="text-[9px] text-gray-400 leading-normal font-mono">
                          Provide your OpenSubtitles.com API Key to dynamically fetch subtitle files directly inside your movie pages.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[8px] text-gray-500 tracking-widest uppercase font-bold">OPENSUBTITLES API KEY</label>
                          <input
                            type="password"
                            placeholder="Enter OpenSubtitles API Key..."
                            value={tempOpensubtitlesKey}
                            onChange={(e) => setTempOpensubtitlesKey(e.target.value)}
                            disabled={isSaving}
                            className="w-full bg-gray-950 border border-gray-855 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-bold font-mono placeholder-gray-700 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {/* OMDB Section */}
                      <div className="space-y-2">
                        <span className="text-[10px] text-accent font-bold tracking-wider block">OMDb API Connection</span>
                        <p className="text-[9px] text-gray-400 leading-normal font-mono">
                          Provide your personal OMDb API Key to dynamically fetch Rotten Tomatoes and IMDb ratings.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[8px] text-gray-500 tracking-widest uppercase font-bold">OMDB API KEY</label>
                          <input
                            type="password"
                            placeholder="Enter OMDB API Key..."
                            value={tempOmdbKey}
                            onChange={(e) => setTempOmdbKey(e.target.value)}
                            disabled={isSaving}
                            className="w-full bg-gray-950 border border-gray-855 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-bold font-mono placeholder-gray-700 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {saveMessage && (
                        <div className="text-[10px] text-center font-bold tracking-wider animate-pulse text-accent border border-accent/20 bg-accent/5 py-1.5 rounded">
                          {saveMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex space-x-3 text-xs pt-4">
                      <button
                        onClick={() => {
                          setShowKeyModal(false);
                        }}
                        disabled={isSaving}
                        className="flex-1 bg-gray-900 border border-gray-800 text-gray-400 font-bold py-2 rounded hover:border-gray-700 hover:text-gray-200 transition-all focus:outline-none disabled:opacity-50"
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={handleSaveKey}
                        disabled={isSaving}
                        className="flex-1 bg-accent text-background font-extrabold py-2 rounded hover:bg-cyan-400 transition-all cyan-glow focus:outline-none shadow-lg disabled:opacity-50"
                      >
                        SAVE KEY
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      <span className="text-[9px] text-rose-500 font-bold tracking-widest uppercase block">Danger Zone: Purge Assets</span>
                      
                      {purgeFeedback && (
                        <div className={`text-[10px] text-center font-bold p-1.5 rounded border ${
                          purgeFeedback.startsWith("Error") || purgeFeedback.startsWith("Access")
                            ? "text-rose-500 border-rose-950 bg-rose-950/10"
                            : "text-accent border-accent/20 bg-accent/5 animate-pulse"
                        }`}>
                          {purgeFeedback}
                        </div>
                      )}

                      {!confirmPurge ? (
                        <div className="space-y-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPurgeTarget("library");
                              setConfirmPurge(true);
                              setPurgeFeedback("");
                            }}
                            disabled={isPurging}
                            className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-1.5 rounded text-[10px] transition-colors focus:outline-none"
                          >
                            PURGE LIBRARY ONLY
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPurgeTarget("schedule");
                              setConfirmPurge(true);
                              setPurgeFeedback("");
                            }}
                            disabled={isPurging}
                            className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-1.5 rounded text-[10px] transition-colors focus:outline-none"
                          >
                            PURGE SCHEDULES ONLY
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPurgeTarget("all_keep_settings");
                              setConfirmPurge(true);
                              setPurgeFeedback("");
                            }}
                            disabled={isPurging}
                            className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-1.5 rounded text-[10px] transition-colors focus:outline-none"
                          >
                            PURGE ALL
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPurgeTarget("all");
                              setConfirmPurge(true);
                              setPurgeFeedback("");
                            }}
                            disabled={isPurging}
                            className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-1.5 rounded text-[10px] transition-colors focus:outline-none"
                          >
                            FULL DATABASE RESET
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1 font-mono">
                          <div className="text-[10px] text-gray-400 leading-normal">
                            Confirm permanently deleting{" "}
                            <span className="text-rose-500 font-bold">
                              {purgeTarget === "library" && "all library media items & files"}
                              {purgeTarget === "schedule" && "all scheduled EPG blocks"}
                              {purgeTarget === "all_keep_settings" && "library and schedules (retaining configurations)"}
                              {purgeTarget === "all" && "everything (complete SQLite database factory reset)"}
                            </span>
                            ? This action is irreversible.
                          </div>

                          <div className="space-y-1">
                            <label className="text-[8px] text-gray-500 tracking-wider uppercase font-bold">Admin Password</label>
                            <input
                              type="password"
                              placeholder="Enter admin password..."
                              value={purgePassword}
                              onChange={(e) => {
                                setPurgePassword(e.target.value);
                                setPurgeFeedback("");
                              }}
                              disabled={isPurging}
                              className="w-full bg-gray-950 border border-gray-850 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-rose-500 text-rose-500 font-bold placeholder-gray-700"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {confirmPurge && (
                      <div className="flex space-x-3 text-xs pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmPurge(false);
                            setPurgeFeedback("");
                            setPurgePassword("");
                          }}
                          disabled={isPurging}
                          className="flex-1 bg-gray-900 border border-gray-800 text-gray-400 font-bold py-1.5 rounded hover:text-gray-200 transition-all focus:outline-none"
                        >
                          CANCEL
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (purgePassword !== "4dmin123") {
                              setPurgeFeedback("Access Denied: Incorrect Password.");
                              return;
                            }
                            
                            setIsPurging(true);
                            setPurgeFeedback("Executing database purge...");
                            try {
                              await invoke("purge_database", { target: purgeTarget });
                              setPurgeFeedback("Purge succeeded!");
                              
                              // Dynamically refresh the relevant stores without reloading the page
                              try {
                                await useLibraryStore.getState().fetchItems();
                              } catch (err) {
                                console.error("Failed to refresh library store:", err);
                              }
                              
                              try {
                                const channelId = useChannelStore.getState().channels[0]?.id || "chan_default";
                                const today = new Date();
                                const day = today.getDay();
                                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                                const startOfWeek = new Date(today.setDate(diff));
                                startOfWeek.setHours(0, 0, 0, 0);
                                
                                const endOfWeek = new Date(startOfWeek);
                                endOfWeek.setDate(endOfWeek.getDate() + 7);
                                
                                await useScheduleStore.getState().fetchEntries(channelId, startOfWeek.toISOString(), endOfWeek.toISOString());
                                await useChannelStore.getState().fetchPlayoutState(channelId, new Date().toISOString());
                              } catch (err) {
                                console.error("Failed to refresh schedule or channel store:", err);
                              }

                              setTimeout(() => {
                                setShowKeyModal(false);
                                setConfirmPurge(false);
                                setPurgeFeedback("");
                                setPurgePassword("");
                                setIsPurging(false);
                              }, 1200);
                            } catch (e) {
                              setPurgeFeedback(`Error: ${e}`);
                              setIsPurging(false);
                            }
                          }}
                          disabled={isPurging || !purgePassword}
                          className="flex-1 bg-rose-600 text-white font-extrabold py-1.5 rounded hover:bg-rose-500 transition-all focus:outline-none animate-pulse shadow-lg shadow-rose-900/20 disabled:opacity-30"
                        >
                          CONFIRM PURGE
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
