import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SplashScreen } from "./pages/SplashScreen";
import { OnAir } from "./pages/OnAir";
import { Library } from "./pages/Library";
import { Grid } from "./pages/Grid";
import { DatabaseViewer } from "./pages/Database";
import { Health } from "./pages/Health";
import { Suggestions } from "./pages/Suggestions";
import { useNotificationStore } from "./store";

function App() {
  const [isBooted, setIsBooted] = useState(false);
  const [activeTab, setActiveTab] = useState("onair");
  const toasts = useNotificationStore((state) => state.toasts);
  const dismissToast = useNotificationStore((state) => state.dismissToast);

  // Show splash screen on boot sequence
  if (!isBooted) {
    return <SplashScreen onComplete={() => setIsBooted(true)} />;
  }

  // Render the selected tab component
  const renderContent = () => {
    switch (activeTab) {
      case "onair":
        return <OnAir />;
      case "library":
        return <Library />;
      case "grid":
        return <Grid />;
      case "database":
        return <DatabaseViewer />;
      case "health":
        return <Health />;
      case "suggestions":
        return <Suggestions />;
      default:
        return <OnAir />;
    }
  };

  return (
    <div className="h-screen w-screen flex bg-background text-gray-200 overflow-hidden font-mono">
      {/* Retractable Navigation panel */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {/* Main Pages viewport canvas */}
      <main className="flex-1 h-full flex flex-col overflow-hidden relative pl-16">
        {/* Scanline overlay for subtle retro NASA control room aesthetic */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[size:100%_4px] pointer-events-none z-40 opacity-30" />
        
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {renderContent()}
        </div>
      </main>

      {/* Toast Notification Container */}
      <div className="absolute bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          let bgClass = "bg-accent/90 border-accent/40 text-background";
          if (toast.type === "success") {
            bgClass = "bg-emerald-950/90 border-emerald-500/40 text-emerald-200";
          } else if (toast.type === "error") {
            bgClass = "bg-rose-950/90 border-rose-500/40 text-rose-200";
          }
          return (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`p-3.5 rounded border shadow-xl flex items-center justify-between cursor-pointer pointer-events-auto backdrop-blur-md transition-all duration-300 transform translate-x-0 font-sans text-xs font-bold ${bgClass}`}
              style={{ animation: "slideIn 0.3s ease-out forwards" }}
            >
              <span>{toast.message}</span>
              <button className="ml-3 text-[12px] opacity-60 hover:opacity-100">×</button>
            </div>
          );
        })}
      </div>

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
