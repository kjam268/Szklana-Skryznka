import React, { useState, useEffect } from "react";

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("System standby...");
  
  const bootLogs = [
    "INITIALIZING TOKIO MULTI-THREADED RUNTIME...",
    "ESTABLISHING SQLITE REPOSITORY POOL...",
    "RUNNING SQLX SCHEMA MIGRATIONS (VERSION 20260621000000_INIT)...",
    "VERIFYING DEFAULT BROADCAST CHANNELS...",
    "SYNCHRONIZING PLAYBACK HISTORY RECORDS...",
    "SCANNING PHYSICAL MEDIA CACHE INDEX...",
    "ON AIR SYSTEM READY. START PLayout Engine."
  ];

  useEffect(() => {
    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < bootLogs.length) {
        setStatusMessage(bootLogs[currentStep]);
        setProgress((prev) => Math.min(prev + (100 / bootLogs.length), 100));
        currentStep++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          onComplete();
        }, 600);
      }
    }, 450);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="h-screen w-screen bg-background flex flex-col items-center justify-center p-8 relative overflow-hidden font-mono selection:bg-accent selection:text-background">
      {/* Scanline CRT overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,6px_100%] pointer-events-none z-50" />
      
      <div className="max-w-xl w-full space-y-8 z-10">
        {/* Animated station emblem */}
        <div className="text-center space-y-3">
          <div className="text-4xl font-extrabold tracking-widest text-accent drop-shadow-[0_0_12px_rgba(6,182,212,0.6)]">
            SZKLANA SKRYZNKA
          </div>
          <div className="text-xs uppercase tracking-widest text-gray-500">
            TV Station Playout OS v0.1.0
          </div>
        </div>

        {/* Diagnostic logs */}
        <div className="bg-panel border border-gray-800 rounded-lg p-6 space-y-4 shadow-2xl relative">
          <div className="absolute top-2 right-4 text-[9px] text-gray-600 tracking-wider">
            MASTER CONTROL CONSOLE
          </div>
          
          <div className="text-xs text-gray-400 min-h-[48px] border-l-2 border-accent pl-3 flex items-center leading-relaxed">
            {statusMessage}
          </div>

          {/* Loading bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>BOOT DIAGNOSTICS PROG</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-950 rounded-full overflow-hidden border border-gray-800">
              <div 
                className="h-full bg-accent transition-all duration-300 cyan-glow"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex justify-between items-center text-[10px] text-gray-600 px-2">
          <span>HOST: RUST_TAURI_DESKTOP</span>
          <span>SYSTEM TIME: {new Date().toLocaleTimeString("en-US", { hour12: false })}</span>
        </div>
      </div>
    </div>
  );
};
