import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SplashScreen } from "./pages/SplashScreen";
import { OnAir } from "./pages/OnAir";
import { Library } from "./pages/Library";
import { Grid } from "./pages/Grid";
import { DatabaseViewer } from "./pages/Database";
import { Health } from "./pages/Health";
import { Suggestions } from "./pages/Suggestions";
import { Watchlist } from "./pages/Watchlist";
import { Settings } from "./pages/Settings";
import { TvClient } from "./pages/TvClient";
import { useNotificationStore } from "./store";
import { useKeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  { section: "THE GRID", rows: [
    { key: "← / →",   desc: "Previous / Next week" },
    { key: "T",        desc: "Jump to this week" },
    { key: "L",        desc: "Toggle Library drawer" },
  ]},
  { section: "ON AIR", rows: [
    { key: "Space",    desc: "Toggle mute" },
    { key: "S",        desc: "Cycle subtitle track" },
    { key: "A",        desc: "Cycle audio track" },
  ]},
  { section: "LIBRARY", rows: [
    { key: "Esc",      desc: "Clear search & filters" },
  ]},
  { section: "GLOBAL", rows: [
    { key: "?",        desc: "Show this cheatsheet" },
  ]},
];

function App() {
  const [isBooted, setIsBooted] = useState(false);
  const [activeTab, setActiveTab] = useState("onair");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toasts = useNotificationStore((state) => state.toasts);
  const dismissToast = useNotificationStore((state) => state.dismissToast);

  // Global ? shortcut — show cheatsheet
  useKeyboardShortcut("?", () => setShowShortcuts(s => !s));
  useKeyboardShortcut("Escape", () => setShowShortcuts(false));

  // Listen for switch-tab events from subcomponents
  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) setActiveTab(customEvent.detail);
    };
    window.addEventListener("switch-tab", handleSwitchTab);
    return () => window.removeEventListener("switch-tab", handleSwitchTab);
  }, []);

  // Bare TV client view
  const isTvClient = window.location.search.includes("view=tv");
  if (isTvClient) return <TvClient />;

  // Splash screen
  if (!isBooted) return <SplashScreen onComplete={() => setIsBooted(true)} />;

  const renderContent = () => {
    switch (activeTab) {
      case "onair":      return <OnAir />;
      case "library":    return <Library />;
      case "grid":       return <Grid />;
      case "database":   return <DatabaseViewer />;
      case "health":     return <Health />;
      case "suggestions":return <Suggestions />;
      case "watchlist":  return <Watchlist />;
      case "settings":   return <Settings />;
      default:           return <OnAir />;
    }
  };

  return (
    <div className="h-screen w-screen flex bg-background text-gray-200 overflow-hidden font-mono">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 h-full flex flex-col overflow-hidden relative pl-16">
        {/* Scanline overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[size:100%_4px] pointer-events-none z-40 opacity-30" />
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {renderContent()}
        </div>
      </main>

      {/* Toast container */}
      <div className="absolute bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          let bgClass = "bg-accent/90 border-accent/40 text-background";
          if (toast.type === "success") bgClass = "bg-emerald-950/90 border-emerald-500/40 text-emerald-200";
          else if (toast.type === "error") bgClass = "bg-rose-950/90 border-rose-500/40 text-rose-200";
          return (
            <div key={toast.id} onClick={() => dismissToast(toast.id)}
              className={`p-3.5 rounded border shadow-xl flex items-center justify-between cursor-pointer pointer-events-auto backdrop-blur-md transition-all duration-300 font-sans text-xs font-bold ${bgClass}`}
              style={{ animation: "slideIn 0.3s ease-out forwards" }}>
              <span>{toast.message}</span>
              <button className="ml-3 text-[12px] opacity-60 hover:opacity-100">×</button>
            </div>
          );
        })}
      </div>

      {/* Keyboard cheatsheet modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}>
          <div className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl w-96 max-w-[90vw] overflow-hidden"
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center space-x-2 text-accent">
                <Keyboard size={16} />
                <span className="text-sm font-bold tracking-widest uppercase">Keyboard Shortcuts</span>
              </div>
              <button onClick={() => setShowShortcuts(false)}
                className="text-gray-500 hover:text-gray-200 transition-colors">
                <X size={16} />
              </button>
            </div>
            {/* Sections */}
            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {SHORTCUTS.map(section => (
                <div key={section.section}>
                  <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                    {section.section}
                  </p>
                  <div className="space-y-1.5">
                    {section.rows.map(row => (
                      <div key={row.key} className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{row.desc}</span>
                        <kbd className="bg-gray-800 border border-gray-700 text-accent text-[10px] font-bold px-2 py-0.5 rounded font-mono">
                          {row.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-800 text-[9px] text-gray-600 text-center">
              Shortcuts are disabled when typing in an input field · Press <span className="text-accent">?</span> or <span className="text-accent">Esc</span> to close
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default App;
