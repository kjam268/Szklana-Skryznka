import React, { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { SplashScreen } from "./pages/SplashScreen";
import { OnAir } from "./pages/OnAir";
import { Library } from "./pages/Library";
import { Grid } from "./pages/Grid";
import { DatabaseViewer } from "./pages/Database";
import { Health } from "./pages/Health";
import { Suggestions } from "./pages/Suggestions";

function App() {
  const [isBooted, setIsBooted] = useState(false);
  const [activeTab, setActiveTab] = useState("onair");



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
    </div>
  );
}

export default App;
