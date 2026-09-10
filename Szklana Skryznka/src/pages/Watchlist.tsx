import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bookmark, Film, Star, Trash2, RotateCw, ArrowRight, BookmarkX, CalendarPlus, Check, X } from "lucide-react";
import { useWatchlistStore, useNotificationStore, useChannelStore } from "../store";

export const Watchlist: React.FC = () => {
  const { items, isLoading, fetchWatchlist, removeItem } = useWatchlistStore();
  const showToast = useNotificationStore(s => s.showToast);
  const { activeChannelId } = useChannelStore();
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [scheduleResult, setScheduleResult] = useState<Record<string, "ok" | "fail">>({});

  const handleAddToSchedule = useCallback(async (title: string, itemId: string) => {
    if (!activeChannelId) { showToast("No active channel selected", "error"); return; }
    setScheduling(itemId);
    try {
      const msg = await invoke<string>("add_watchlist_item_to_schedule", {
        channelId: activeChannelId,
        title,
        preferredDateIso: new Date().toISOString(),
      });
      setScheduleResult(r => ({ ...r, [itemId]: "ok" }));
      showToast(msg, "success");
    } catch (e: any) {
      setScheduleResult(r => ({ ...r, [itemId]: "fail" }));
      showToast(String(e), "error");
    } finally {
      setScheduling(null);
    }
  }, [activeChannelId, showToast]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const formatDate = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric"
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="flex-1 h-screen flex flex-col p-6 bg-background text-gray-200 font-mono overflow-hidden">
      {/* HEADER */}
      <div className="shrink-0 space-y-3">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shadow-sm">
              <Bookmark size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-widest text-accent uppercase">
                ACQUISITION WATCHLIST
              </h1>
              <p className="text-[10px] text-gray-400">
                Movies from the worldwide database saved for future acquisition and scheduling
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-gray-500 font-bold">
              {items.length} TITLE{items.length !== 1 ? "S" : ""} SAVED
            </span>
            <button
              onClick={fetchWatchlist}
              disabled={isLoading}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs rounded px-3 py-1.5 border border-gray-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RotateCw size={12} className={isLoading ? "animate-spin" : ""} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 mt-4 overflow-y-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            <RotateCw size={18} className="animate-spin mr-2 text-accent" />
            Loading watchlist...
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-3">
            <BookmarkX size={40} className="text-gray-700" />
            <p className="text-xs font-bold">WATCHLIST IS EMPTY</p>
            <p className="text-[10px] text-gray-600 max-w-xs text-center leading-relaxed">
              Browse the Smart Suggestions page and add titles you'd like to acquire for your broadcast library.
            </p>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "suggestions" }))}
              className="flex items-center space-x-1.5 text-[10px] font-bold text-accent bg-accent/10 border border-accent/30 hover:bg-accent hover:text-background px-3 py-1.5 rounded transition-all"
            >
              <ArrowRight size={12} />
              <span>BROWSE SUGGESTIONS</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
            {items.map(item => (
              <div
                key={item.id}
                className="bg-panel border border-gray-800 rounded-lg overflow-hidden hover:border-accent/40 transition-all group flex flex-col"
              >
                {/* Poster */}
                <div className="relative w-full aspect-[2/3] bg-gray-950 overflow-hidden shrink-0">
                  {item.poster_path ? (
                    <img
                      src={item.poster_path}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-700">
                      <Film size={32} />
                      <span className="text-[9px] text-gray-600 font-bold mt-2">NO ARTWORK</span>
                    </div>
                  )}
                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  {/* Rating badge */}
                  {item.rating && (
                    <div className="absolute top-2 right-2 flex items-center space-x-1 bg-black/70 backdrop-blur-sm border border-gray-700/50 rounded px-1.5 py-0.5">
                      <Star size={9} className="text-amber-500 fill-amber-500" />
                      <span className="text-[9px] font-bold text-gray-200">{item.rating.toFixed(1)}</span>
                    </div>
                  )}
                  {/* Remove button */}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="absolute top-2 left-2 bg-rose-600/80 hover:bg-rose-500 backdrop-blur-sm text-white rounded p-1.5 opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove from watchlist"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                {/* Info */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-gray-200 group-hover:text-accent transition-colors leading-tight line-clamp-2">
                      {item.title}
                    </h3>
                    <div className="flex items-center space-x-2 mt-1 text-[9px] text-gray-500 font-bold">
                      {item.year && <span>{item.year}</span>}
                      {item.director && (
                        <>
                          <span className="text-gray-700">•</span>
                          <span className="truncate">{item.director}</span>
                        </>
                      )}
                    </div>
                    {item.synopsis && (
                      <p className="text-[10px] text-gray-500 mt-2 leading-relaxed line-clamp-3 font-sans">
                        {item.synopsis}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleAddToSchedule(item.title, item.id)}
                      disabled={scheduling === item.id}
                      className={`flex items-center space-x-1 text-[9px] font-bold px-2 py-1 rounded border transition-all ${
                        scheduleResult[item.id] === "ok"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : scheduleResult[item.id] === "fail"
                          ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                          : "bg-accent/10 border-accent/30 text-accent hover:bg-accent hover:text-background"
                      } disabled:opacity-50`}
                    >
                      {scheduling === item.id ? <RotateCw size={10} className="animate-spin" />
                       : scheduleResult[item.id] === "ok" ? <Check size={10} />
                       : scheduleResult[item.id] === "fail" ? <X size={10} />
                       : <CalendarPlus size={10} />}
                      <span>
                        {scheduling === item.id ? "SCHEDULING…"
                         : scheduleResult[item.id] === "ok" ? "SCHEDULED"
                         : scheduleResult[item.id] === "fail" ? "NOT IN LIBRARY"
                         : "ADD TO SCHEDULE"}
                      </span>
                    </button>
                    <div className="flex flex-col items-end space-y-0.5">
                      <span className="text-[8px] text-gray-700 font-mono">SAVED {formatDate(item.added_at)}</span>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="flex items-center space-x-1 text-[9px] font-bold text-rose-500/70 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={10} />
                        <span>REMOVE</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="mt-3 pt-3 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between shrink-0">
        <span>WATCHLIST STORAGE: SQLITE LOCAL DB</span>
        <span className="text-accent font-bold">{items.length} ACQUISITION TARGETS TRACKED</span>
      </div>
    </div>
  );
};
