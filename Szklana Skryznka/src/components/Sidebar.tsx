import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Tv, Film, CalendarDays, Database, Activity, Lightbulb, 
  ChevronLeft, ChevronRight, Settings
} from "lucide-react";
import { useLibraryStore, useScheduleStore, useChannelStore } from "../store";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [tmdbStatus, setTmdbStatus] = useState<"checking" | "connected" | "disconnected" | "none">("checking");

  const [purgeTarget, setPurgeTarget] = useState<"library" | "schedule" | "all_keep_settings" | "all">("library");
  const [purgePassword, setPurgePassword] = useState("");
  const [isPurging, setIsPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState("");

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

  useEffect(() => {
    checkConnection();
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
    } catch (e) {
      console.error("Failed to load TMDb key:", e);
    }
    setShowKeyModal(true);
  };

  const handleSaveKey = async () => {
    setIsSaving(true);
    setSaveMessage("Testing API connection...");
    try {
      const key_trimmed = tempKey.trim();
      await invoke("set_setting", { key: "tmdb_api_key", value: key_trimmed });
      setTmdbStatus("checking");
      if (key_trimmed === "") {
        setTmdbStatus("none");
        setSaveMessage("API Key cleared successfully.");
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
          setSaveMessage("Connected successfully!");
        } else {
          setTmdbStatus("disconnected");
          setSaveMessage("Failed: Invalid API Key.");
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
        className={`h-screen bg-panel border-r border-gray-800 flex flex-col justify-between transition-all duration-300 shrink-0 ${
          isCollapsed ? "w-16" : "w-64"
        }`}
      >
        <div>
          {/* Header Branding */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
            {!isCollapsed && (
              <div className="flex items-center space-x-2">
                <Tv size={18} className="text-accent animate-pulse drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                <span className="font-mono text-sm tracking-widest font-bold text-gray-200">
                  SZKLANA SKRYZNKA
                </span>
              </div>
            )}
            {isCollapsed && (
              <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] font-mono font-bold text-background mx-auto">
                SS
              </span>
            )}
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-gray-400 hover:text-accent focus:outline-none p-1 rounded hover:bg-gray-800 transition-colors"
            >
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
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
                  <div className="flex items-center space-x-3 w-full">
                    <Icon size={18} className={isActive ? (item.highlight ? "text-onair" : "text-accent") : "text-gray-400"} />
                    {!isCollapsed && (
                      <div className="flex justify-between items-center w-full">
                        <span>{item.label}</span>
                        {item.highlight && (
                          <span className="text-[9px] bg-onair/20 text-onair px-1.5 py-0.5 rounded font-sans tracking-wide animate-pulse">
                            ON AIR
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / System status */}
        <div className="p-4 border-t border-gray-800 text-[10px] font-mono text-gray-500 space-y-3">
          {!isCollapsed ? (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>SYS STATUS:</span>
                <span className="text-accent font-bold">ONLINE</span>
              </div>
              <div className="flex justify-between">
                <span>DB SYNC:</span>
                <span className="text-emerald-500 font-bold">STABLE</span>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-800">
                <span className="flex items-center space-x-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    tmdbStatus === "connected" ? "bg-emerald-500 cyan-glow" :
                    tmdbStatus === "disconnected" ? "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                    tmdbStatus === "checking" ? "bg-amber-500 animate-pulse" : "bg-gray-700"
                  }`} title={`TMDb API Status: ${tmdbStatus.toUpperCase()}`} />
                  <span className="font-bold">TMDB:</span>
                </span>
                <button 
                  onClick={handleOpenModal}
                  className="text-accent hover:text-cyan-400 font-bold tracking-wider transition-colors focus:outline-none"
                >
                  TMDb KEY
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-2">
              <button 
                onClick={handleOpenModal}
                title={`TMDb Settings (Status: ${tmdbStatus.toUpperCase()})`}
                className="text-gray-400 hover:text-accent p-1 rounded hover:bg-gray-800 transition-colors focus:outline-none relative"
              >
                <Settings size={16} className="hover:rotate-45 transition-transform duration-300" />
                <span className={`absolute top-0 right-0 w-1.5 h-1.5 rounded-full ${
                  tmdbStatus === "connected" ? "bg-emerald-500" :
                  tmdbStatus === "disconnected" ? "bg-rose-500" :
                  tmdbStatus === "checking" ? "bg-amber-500 animate-pulse" : "bg-gray-700"
                }`} />
              </button>
              <div className="text-center text-accent animate-pulse font-bold">
                OK
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Retro-styled TMDb Key Config Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 select-none font-mono">
          <div className="bg-panel border border-accent/40 shadow-[0_0_20px_rgba(6,182,212,0.25)] rounded-lg p-6 max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-gray-800 pb-2.5">
              <span className="text-xs font-bold text-accent tracking-widest flex items-center space-x-1.5">
                <Settings size={14} className="animate-pulse text-accent" />
                <span>TMDb API KEY CONFIG</span>
              </span>
              <button 
                onClick={() => setShowKeyModal(false)}
                className="text-gray-500 hover:text-gray-300 text-xs font-bold focus:outline-none"
              >
                CLOSE
              </button>
            </div>

            <p className="text-[10px] text-gray-400 leading-relaxed font-mono">
              Provide your personal TMDb API v3 key to enable automatic poster graphics and plot summaries scanning from online records.
            </p>

            <div className="space-y-1.5">
              <label className="text-[9px] text-gray-500 tracking-widest uppercase font-bold">API v3 Key</label>
              <input
                type="password"
                placeholder="Enter API key..."
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
                disabled={isSaving}
                className="w-full bg-gray-950 border border-gray-850 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-accent text-accent font-bold font-mono placeholder-gray-700 disabled:opacity-50"
              />
            </div>

            {saveMessage && (
              <div className="text-[10px] text-center font-bold tracking-wider animate-pulse text-accent border border-accent/20 bg-accent/5 py-1.5 rounded">
                {saveMessage}
              </div>
            )}

            <div className="flex space-x-3 pt-2 text-xs">
              <button
                onClick={() => setShowKeyModal(false)}
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

            <div className="border-t border-gray-800 pt-4 space-y-3">
              <span className="text-[9px] text-rose-500 font-bold tracking-widest uppercase">Danger Zone: Purge Assets</span>
              
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
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPurgeTarget("library");
                      setConfirmPurge(true);
                      setPurgeFeedback("");
                    }}
                    disabled={isPurging}
                    className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-2 rounded text-[10px] transition-colors focus:outline-none"
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
                    className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-2 rounded text-[10px] transition-colors focus:outline-none"
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
                    className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-2 rounded text-[10px] transition-colors focus:outline-none"
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
                    className="w-full bg-transparent border border-rose-800/60 hover:border-rose-600 hover:bg-rose-950/25 text-rose-500 font-bold py-2 rounded text-[10px] transition-colors focus:outline-none"
                  >
                    FULL DATABASE RESET
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-1 font-mono">
                  <div className="text-[10px] text-gray-400 leading-relaxed">
                    Confirm permanently deleting{" "}
                    <span className="text-rose-500 font-bold">
                      {purgeTarget === "library" && "all cataloged library media items & files"}
                      {purgeTarget === "schedule" && "all scheduled EPG blocks & timelines"}
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
                      className="w-full bg-gray-950 border border-gray-850 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-rose-500 text-rose-500 font-bold placeholder-gray-700"
                    />
                  </div>

                  <div className="flex space-x-3 text-xs pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmPurge(false);
                        setPurgeFeedback("");
                        setPurgePassword("");
                      }}
                      disabled={isPurging}
                      className="flex-1 bg-gray-900 border border-gray-800 text-gray-400 font-bold py-2 rounded-lg hover:text-gray-200 transition-all focus:outline-none"
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
                      className="flex-1 bg-rose-600 text-white font-extrabold py-2 rounded-lg hover:bg-rose-500 transition-all focus:outline-none animate-pulse shadow-lg shadow-rose-900/20 disabled:opacity-30"
                    >
                      CONFIRM PURGE
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
