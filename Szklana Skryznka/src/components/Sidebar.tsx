import React, { useState } from "react";
import { 
  Tv, Film, CalendarDays, Database, Activity, Lightbulb, 
  ChevronLeft, ChevronRight, HardDriveDownload
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { id: "onair", label: "Szklana Skryznka", icon: Tv, highlight: true },
    { id: "library", label: "The Library", icon: Film },
    { id: "grid", label: "The Grid", icon: CalendarDays },
    { id: "database", label: "Database Viewer", icon: Database },
    { id: "health", label: "Health & Integrity", icon: Activity },
    { id: "suggestions", label: "Smart Suggestions", icon: Lightbulb },
  ];

  return (
    <aside 
      className={`h-screen bg-panel border-r border-gray-800 flex flex-col justify-between transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      <div>
        {/* Header Branding */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
          {!isCollapsed && (
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse cyan-glow" />
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
      <div className="p-4 border-t border-gray-800 text-[10px] font-mono text-gray-500">
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
          </div>
        ) : (
          <div className="text-center text-accent animate-pulse font-bold">
            OK
          </div>
        )}
      </div>
    </aside>
  );
};
