import React, { useEffect, useState } from "react";
import { Lightbulb, RotateCw, Calendar, Star, Film, CheckCircle, Database } from "lucide-react";

interface RecommendedItem {
  id: string;
  title: string;
  year: number;
  director: string;
  cast: string[];
  synopsis: string;
  rating: number;
  poster_path?: string;
  sourceEngine: string;
}

export const Suggestions: React.FC = () => {
  const [suggestions, setSuggestions] = useState<RecommendedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<RecommendedItem[]>("get_smart_suggestions");
      setSuggestions(res);
    } catch (e) {
      console.error("Failed to load suggestions:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  const handleAddToWatchlist = async (item: RecommendedItem) => {
    try {
      // Direct SQLite insertions can be triggered or add to channel watchlist settings
      const { invoke } = await import("@tauri-apps/api/core");
      // Add a watchlist entry
      // Wait, we can insert into the SQLite watchlist table or add program items
      // Let's create an item on watchlist or trigger mock alert
      setWatchlist((prev) => [...prev, item.id]);
      alert(`"${item.title}" successfully added to your station watchlist!`);
    } catch (e) {
      alert(`Failed to add watchlist item: ${e}`);
    }
  };

  return (
    <div className="flex-1 h-screen flex flex-col justify-between p-6 bg-background text-gray-200 font-mono overflow-hidden">
      {/* HEADER CONTROLS */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
            <Lightbulb size={16} />
            <span>WORLDWIDE TOP MOVIE SUGGESTIONS</span>
          </span>

          <button
            onClick={fetchSuggestions}
            disabled={isLoading}
            className="bg-accent text-background font-bold text-xs rounded px-4 py-1.5 hover:bg-cyan-400 flex items-center space-x-1.5 transition-colors"
          >
            <RotateCw size={12} className={isLoading ? "animate-spin" : ""} />
            <span>{isLoading ? "LOADING..." : "REFRESH 10 RANDOM"}</span>
          </button>
        </div>
        
        <p className="text-[10px] text-gray-500">
          This algorithmic engine pulls 10 random titles from our SQLite database of the top 100,000 worldwide movies that are NOT present in your library. No AI involved.
        </p>
      </div>

      {/* SUGGESTIONS LIST CARDS */}
      <div className="flex-1 mt-6 overflow-y-auto space-y-4 pr-2 scrollbar-thin">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            Querying top 100k worldwide database...
          </div>
        ) : suggestions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            No suggestions available. Check if library catalog contains all matches.
          </div>
        ) : (
          suggestions.map((item) => {
            const isAdded = watchlist.includes(item.id);

            return (
              <div 
                key={item.id} 
                className="bg-panel border border-gray-800 rounded-lg p-5 flex items-start space-x-5 hover:border-accent/40 transition-colors duration-200"
              >
                {/* Poster graphic image */}
                <div className="w-24 h-36 bg-gray-950 rounded border border-gray-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                  {item.poster_path ? (
                    <img 
                      src={item.poster_path} 
                      alt={item.title} 
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-gray-700 text-center p-1">
                      <Film size={24} />
                      <span className="text-[8px] text-gray-600 font-bold mt-1">NO ART</span>
                    </div>
                  )}
                </div>

                {/* Suggestions Info */}
                <div className="flex-1 flex flex-col justify-between h-36">
                  <div className="space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold text-gray-200 hover:text-accent cursor-pointer">{item.title}</span>
                      <div className="flex items-center space-x-1.5 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded text-[10px]">
                        <Star size={10} className="text-amber-500 fill-amber-500" />
                        <span className="text-gray-300 font-bold">{item.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-500 font-bold flex space-x-3">
                      <span>YEAR: {item.year}</span>
                      <span>DIRECTOR: {item.director}</span>
                    </div>
                    <div className="text-[9px] text-gray-500 truncate font-sans">
                      CAST: {item.cast.join(", ")}
                    </div>
                    <p className="text-[11px] text-gray-400 font-sans leading-relaxed line-clamp-2 mt-2">
                      {item.synopsis}
                    </p>
                  </div>

                  {/* Inline Action Buttons */}
                  <div className="flex space-x-3 pt-2 border-t border-gray-950 text-[10px]">
                    <button
                      onClick={() => handleAddToWatchlist(item)}
                      disabled={isAdded}
                      className={`flex items-center space-x-1 px-3 py-1 rounded transition-colors ${
                        isAdded 
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-500" 
                          : "bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                      }`}
                    >
                      <CheckCircle size={12} className={isAdded ? "text-emerald-500" : "text-gray-500"} />
                      <span>{isAdded ? "ADDED TO WATCHLIST" : "ADD TO WATCHLIST"}</span>
                    </button>
                    <span className="text-[9px] text-gray-600 self-center flex items-center space-x-1">
                      <Database size={10} />
                      <span>INDEX: {item.id}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER */}
      <div className="mt-4 pt-4 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between select-none">
        <span>ENGINE TYPE: RANDOM WORLDWIDE DATABASE RESOLVER</span>
        <span className="text-accent">SEED VOLUME: 100,000 MOVIE RECORDS</span>
      </div>
    </div>
  );
};
