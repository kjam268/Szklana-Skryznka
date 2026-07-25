import React, { useState, useRef, useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Calendar, ChevronLeft, ChevronRight, Menu, Search, X, Film, Folder } from "lucide-react";
import { useLibraryStore, useChannelStore, useNotificationStore, MediaItemDetails } from "../store";

export const Grid: React.FC = () => {
  interface ScheduleEntryDetails {
    id: string;
    schedule_id: string;
    media_item_id: string;
    start_time: string;
    end_time: string;
    is_locked: number;
    explanation: string | null;
    item_title: string;
    media_type: string;
    duration: number;
    poster_path: string | null;
    backdrop_path: string | null;
    file_path: string | null;
  }

  const { items, fetchItems } = useLibraryStore();
  const { channels, fetchChannels } = useChannelStore();
  const showToast = useNotificationStore((state) => state.showToast);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("All");
  const [activeShowName, setActiveShowName] = useState<string | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryDetails[]>([]);
  const [draggedOverCell, setDraggedOverCell] = useState<{ dayIdx: number; slotIdx: number; isBottomHalf: boolean } | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggedOriginEntryId, setDraggedOriginEntryId] = useState<string | null>(null);
  const libraryTabs = ["All", "Movie", "TV show", "Documentary", "Animation", "Shorts", "Favorites", "Kids", "Classic", "Not Found"];

  const activeChannelId = channels[0]?.id || "chan_default";

  // Snap rolling week to start on the current week's Monday at 07:00
  const [startOfWeek, setStartOfWeek] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(7, 0, 0, 0);
    return monday;
  });

  const timeColumnRef = useRef<HTMLDivElement>(null);
  const gridCellsRef = useRef<HTMLDivElement>(null);

  const fetchSchedule = async () => {
    try {
      const startIso = startOfWeek.toISOString();
      const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
      const endIso = endOfWeek.toISOString();
      const data = await invoke<ScheduleEntryDetails[]>("get_schedule_entries", {
        channelId: activeChannelId,
        startTimeIso: startIso,
        endTimeIso: endIso,
      });
      setScheduleEntries(data);
    } catch (err) {
      console.error("Failed to fetch schedule entries:", err);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    try {
      await invoke("delete_schedule_entry", { entryId });
      showToast("Deleted schedule entry", "success");
      fetchSchedule();
    } catch (err) {
      showToast(`Delete failed: ${err}`, "error");
      console.error("Failed to delete schedule entry:", err);
    }
  };

  useEffect(() => {
    fetchChannels();
    // Ensure default channel is initialized in the DB before fetching/writing schedules
    invoke("get_channel_status")
      .then(() => {
        fetchItems();
        fetchSchedule();
      })
      .catch((err) => {
        console.error("Failed to initialize channel status:", err);
        fetchItems();
        fetchSchedule();
      });
  }, [fetchItems, startOfWeek, activeChannelId, fetchChannels]);

  // Calculate 7 rolling days of the week starting from Monday (startOfWeek)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Adjust start of week by +/- 7 days
  const handlePrevWeek = () => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() - 7);
    setStartOfWeek(d);
  };

  const handleNextWeek = () => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + 7);
    setStartOfWeek(d);
  };

  const handleResetToToday = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(7, 0, 0, 0);
    setStartOfWeek(monday);
  };

  const formatRuntime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };

  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };

  const getShowName = (title: string) => {
    const match = title.match(/^(.*?) - S\d{2}E\d{2}/i);
    if (match) {
      return match[1].trim();
    }
    return title;
  };

  const parseEpisodeTitle = (title: string) => {
    const match = title.match(/^(.*?)\s*-\s*S(\d{2})E(\d{2})(?:\s*-\s*(.*))?$/i);
    if (match) {
      const showName = match[1].trim();
      const season = match[2];
      const episode = match[3];
      const epName = match[4] ? match[4].trim() : "Episode " + parseInt(episode, 10);
      return {
        showName,
        season,
        episode,
        epName,
        isEpisode: true
      };
    }
    return {
      showName: title,
      season: "",
      episode: "",
      epName: "",
      isEpisode: false
    };
  };

  return (
    <div className="flex-1 h-screen flex flex-row bg-background text-gray-200 font-mono overflow-hidden relative">
      {/* TIMELINE LIST CONTAINER */}
      <div className="flex-1 flex flex-col justify-between p-6 overflow-hidden">
        {/* Timeline Header Controls */}
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-800 pb-3">
            <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
              <Calendar size={16} className="text-accent" />
              <span>THE GRID WEEKLY SCHEDULE (MON - MON)</span>
            </span>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-3 bg-gray-950 p-1 border border-gray-900 rounded-lg">
                <button
                  onClick={handlePrevWeek}
                  className="p-1 hover:text-accent hover:bg-gray-900 rounded transition-all"
                  title="Previous Week"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={handleResetToToday}
                  className="text-[10px] px-2.5 py-0.5 bg-panel border border-gray-800 rounded hover:border-accent text-gray-400 font-bold transition-all"
                >
                  THIS WEEK
                </button>
                <span className="text-[10px] text-gray-400 font-bold px-2">
                  {weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <button
                  onClick={handleNextWeek}
                  className="p-1 hover:text-accent hover:bg-gray-900 rounded transition-all"
                  title="Next Week"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                onClick={() => setIsDrawerOpen(prev => !prev)}
                className={`text-xs px-3.5 py-1.5 font-bold rounded-lg transition-all flex items-center space-x-1.5 border ${
                  isDrawerOpen 
                    ? "bg-accent/15 text-accent border-accent/30 shadow-[0_0_12px_rgba(6,182,212,0.2)]" 
                    : "bg-panel border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                <Menu size={14} />
                <span>LIBRARY</span>
              </button>
            </div>
          </div>
        </div>

        {/* TIMELINE LIST CANVAS */}
        <div className="flex-1 overflow-hidden mt-6 border border-gray-800 bg-gray-950 rounded-lg shadow-inner flex flex-row">
          
          {/* LEFT: STATIC TIME INDICATORS COLUMN (fixed horizontally, scrolls vertically with container) */}
          <div 
            ref={timeColumnRef}
            className="w-20 shrink-0 flex flex-col bg-gray-950 border-r border-gray-800 select-none overflow-hidden"
          >
            {/* TIME Header Box */}
            <div className="p-3 h-[43px] text-center text-[10px] text-gray-500 font-bold border-b border-gray-800 bg-gray-900 sticky top-0 z-30 flex items-center justify-center uppercase">
              TIME
            </div>
            {/* TIME Slots list */}
            {Array.from({ length: 48 }, (_, slotIdx) => {
              const hourIdx = Math.floor(slotIdx / 2);
              const isHalfHour = slotIdx % 2 === 1;
              const hour = (7 + hourIdx) % 24;
              const hourStr = hour.toString().padStart(2, "0") + (isHalfHour ? ":30" : ":00");
              
              let labelColor = "";
              let labelText = "";
              let timeBlockColor = "";
              if (hour >= 7 && hour < 12) {
                labelColor = "text-emerald-400";
                labelText = "MORNING";
                timeBlockColor = "bg-emerald-950/30 border-r border-emerald-800/40 border-b border-gray-900/50";
              } else if (hour >= 12 && hour < 17) {
                labelColor = "text-amber-400";
                labelText = "AFTERNOON";
                timeBlockColor = "bg-amber-950/30 border-r border-amber-800/40 border-b border-gray-900/50";
              } else if (hour >= 17 && hour < 22) {
                labelColor = "text-rose-400";
                labelText = "EVENING";
                timeBlockColor = "bg-rose-950/30 border-r border-rose-800/40 border-b border-gray-900/50";
              } else {
                labelColor = "text-indigo-400";
                labelText = "NIGHT";
                timeBlockColor = "bg-indigo-950/30 border-r border-indigo-900/40 border-b border-gray-900/50";
              }

              return (
                <div key={slotIdx} className={`h-[64px] shrink-0 flex flex-col items-center justify-center space-y-0.5 ${timeBlockColor}`}>
                  <span className="text-[11px] font-bold text-gray-200">{hourStr}</span>
                  <span className={`text-[7px] font-bold tracking-widest ${labelColor}`}>{labelText}</span>
                </div>
              );
            })}
          </div>

          {/* RIGHT: SCROLLABLE DAYS GRID */}
          <div 
            ref={gridCellsRef}
            onScroll={(e) => {
              if (timeColumnRef.current) {
                timeColumnRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            onDragLeave={() => setDraggedOverCell(null)}
            className="flex-1 overflow-auto scrollbar-thin"
          >
            <div className="min-w-[1250px] flex flex-col">
              {/* Header row */}
              <div className="flex border-b border-gray-800 bg-gray-900/90 sticky top-0 z-30">
                {weekDays.map((day, idx) => (
                  <div key={idx} className="flex-1 p-3 text-center border-r border-gray-800 text-xs font-bold text-accent select-none">
                    {day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
                  </div>
                ))}
              </div>

              {/* Grid slots cells */}
              <div className="flex">
                {weekDays.map((dayDate, dayIdx) => {
                  // Get dayStart and dayEnd for schedule entries filtering
                  const dayStart = new Date(dayDate);
                  dayStart.setHours(7, 0, 0, 0);
                  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

                  // Filter schedule entries that start on this day
                  const dayEntries = scheduleEntries.filter((details) => {
                    const entryStart = new Date(details.start_time);
                    return entryStart >= dayStart && entryStart < dayEnd;
                  });

                  return (
                    <div 
                      key={dayIdx} 
                      className="flex-1 flex flex-col relative border-r border-gray-900"
                    >
                      {/* Grid cells */}
                      {Array.from({ length: 48 }, (_, slotIdx) => {
                        const hourIdx = Math.floor(slotIdx / 2);
                        const isHalfHour = slotIdx % 2 === 1;
                        const hour = (7 + hourIdx) % 24;
                        const timeStr = hour.toString().padStart(2, "0") + (isHalfHour ? ":30" : ":00");

                        let blockColor = "";
                        let textColor = "";
                        if (hour >= 7 && hour < 12) {
                          blockColor = "from-emerald-950/15 to-emerald-900/5 hover:from-emerald-950/30 hover:to-emerald-900/15 border-emerald-800/20";
                          textColor = "text-emerald-400/30 group-hover:text-emerald-400";
                        } else if (hour >= 12 && hour < 17) {
                          blockColor = "from-amber-950/15 to-amber-900/5 hover:from-amber-950/30 hover:to-amber-900/15 border-amber-800/20";
                          textColor = "text-amber-400/30 group-hover:text-amber-400";
                        } else if (hour >= 17 && hour < 22) {
                          blockColor = "from-rose-950/15 to-rose-900/5 hover:from-rose-950/30 hover:to-rose-900/15 border-rose-800/20";
                          textColor = "text-rose-400/30 group-hover:text-rose-400";
                        } else {
                          blockColor = "from-indigo-950/15 to-indigo-900/5 hover:from-indigo-950/30 hover:to-indigo-900/15 border-indigo-800/20";
                          textColor = "text-indigo-400/30 group-hover:text-indigo-400";
                        }

                        const isDraggedOver = draggedOverCell?.dayIdx === dayIdx && draggedOverCell?.slotIdx === slotIdx;
                        const hoveredIsBottomHalf = isDraggedOver && draggedOverCell?.isBottomHalf;

                        // Calculate display time showing 15 minutes slip on hover
                        let activeTimeStr = timeStr;
                        if (isDraggedOver) {
                          const baseMinutes = isHalfHour ? 30 : 0;
                          const activeMinutes = baseMinutes + (hoveredIsBottomHalf ? 15 : 0);
                          activeTimeStr = hour.toString().padStart(2, "0") + ":" + activeMinutes.toString().padStart(2, "0");
                        }

                        return (
                          <div 
                            key={slotIdx}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer) {
                                e.dataTransfer.dropEffect = "move";
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              const mouseY = e.clientY - rect.top;
                              const isBottom = mouseY >= rect.height / 2;
                              if (
                                draggedOverCell?.dayIdx !== dayIdx ||
                                draggedOverCell?.slotIdx !== slotIdx ||
                                draggedOverCell?.isBottomHalf !== isBottom
                              ) {
                                setDraggedOverCell({ dayIdx, slotIdx, isBottomHalf: isBottom });
                              }
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                            }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const isBottom = draggedOverCell?.isBottomHalf || false;
                              setDraggedOverCell(null);
                              const mediaItemId = e.dataTransfer.getData("text/plain") || draggedItemId;
                              if (!mediaItemId) {
                                showToast("Failed to schedule: No media item ID was dragged", "error");
                                return;
                              }
                              // Calculate exact target start date and time including 15-minute slip
                              const targetTime = new Date(dayStart.getTime() + slotIdx * 30 * 60 * 1000 + (isBottom ? 15 : 0) * 60 * 1000);
                              try {
                                await invoke("create_schedule", {
                                  channelId: activeChannelId,
                                  mediaItemId,
                                  startTimeIso: targetTime.toISOString(),
                                  isLocked: true,
                                  explanation: "Manual drag and drop programming",
                                });

                                // Delete original entry if we dragged an existing scheduled card
                                const originId = e.dataTransfer.getData("originEntryId") || draggedOriginEntryId;
                                if (originId) {
                                  await invoke("delete_schedule_entry", { entryId: originId });
                                }

                                showToast(originId ? "Program moved successfully" : "Program scheduled successfully", "success");
                                fetchSchedule();
                              } catch (err) {
                                showToast(`Action failed: ${err}`, "error");
                                console.error("Move/Schedule insertion failed:", err);
                              }
                            }}
                            className={`group h-[64px] shrink-0 flex items-center justify-center transition-all duration-200 relative bg-gradient-to-br border-l border-gray-900/20 ${
                              isHalfHour ? "border-b border-dashed border-gray-800/30" : "border-b border-solid border-gray-800/60"
                            } ${
                              isDraggedOver ? "bg-accent/15 border-accent/60 border z-20 scale-[0.98] shadow-[0_0_12px_rgba(6,182,212,0.3)]" : blockColor
                            }`}
                          >
                            {/* Dotted horizontal splitter line */}
                            {isDraggedOver && (
                              <div className="absolute top-1/2 left-0 right-0 border-t border-dotted border-accent/60 z-20 pointer-events-none" />
                            )}

                            {/* Hover highlights for active 15-minute sub-slot */}
                            {isDraggedOver && !hoveredIsBottomHalf && (
                              <div className="absolute top-0 left-0 right-0 bottom-1/2 bg-accent/15 pointer-events-none z-10" />
                            )}
                            {isDraggedOver && hoveredIsBottomHalf && (
                              <div className="absolute top-1/2 left-0 right-0 bottom-0 bg-accent/15 pointer-events-none z-10" />
                            )}

                            <span 
                              className={`select-none font-bold tracking-tighter leading-none transition-all duration-150 z-20 pointer-events-none ${
                                isDraggedOver ? "text-[20px] text-accent font-bold" : `text-[32px] ${textColor}`
                              }`}
                              style={{ fontFamily: "'PT Sans', sans-serif" }}
                            >
                              {activeTimeStr}
                            </span>
                          </div>
                        );
                      })}

                      {/* Scheduled overlay cards */}
                      {dayEntries.map((details) => {
                        const entryStart = new Date(details.start_time);
                        const startOffsetMs = entryStart.getTime() - dayStart.getTime();
                        const startSlot = startOffsetMs / (30 * 60 * 1000);
                        const topPx = startSlot * 64;
                        const durationMinutes = (new Date(details.end_time).getTime() - entryStart.getTime()) / (60 * 1000);
                        const heightPx = (durationMinutes / 30) * 64;
                        
                        const startHour = entryStart.getHours();
                        let cardStyle = "";
                        let deleteBtnStyle = "";
                        if (startHour >= 7 && startHour < 12) {
                          cardStyle = "bg-emerald-950 border-emerald-500/40 text-emerald-100 hover:border-emerald-500/80 shadow-[0_0_15px_rgba(16,185,129,0.15)]";
                          deleteBtnStyle = "hover:bg-emerald-800/50 hover:text-red-400";
                        } else if (startHour >= 12 && startHour < 17) {
                          cardStyle = "bg-amber-950 border-amber-500/40 text-amber-100 hover:border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.15)]";
                          deleteBtnStyle = "hover:bg-amber-800/50 hover:text-red-400";
                        } else if (startHour >= 17 && startHour < 22) {
                          cardStyle = "bg-rose-950 border-rose-500/40 text-rose-100 hover:border-rose-500/80 shadow-[0_0_15px_rgba(244,63,94,0.15)]";
                          deleteBtnStyle = "hover:bg-rose-800/50 hover:text-red-400";
                        } else {
                          cardStyle = "bg-indigo-950 border-indigo-500/40 text-indigo-100 hover:border-indigo-500/80 shadow-[0_0_15px_rgba(99,102,241,0.15)]";
                          deleteBtnStyle = "hover:bg-indigo-800/50 hover:text-red-400";
                        }

                        const formatTimeStr = (date: Date) => {
                          return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
                        };

                        // Algorithm to calculate overlapping columns (sub-tracks)
                        const overlaps = dayEntries.filter(other => {
                          if (other.id === details.id) return false;
                          const otherStart = new Date(other.start_time);
                          const otherEnd = new Date(other.end_time);
                          return (entryStart < otherEnd && new Date(details.end_time) > otherStart);
                        });

                        const hasConflict = overlaps.length > 0;

                        // Calculate horizontal position
                        let leftPercent = 4;
                        let rightPercent = 4;
                        if (hasConflict) {
                          // Sort all overlapping entries (including current one) by start_time, then ID
                          const group = [...overlaps, details].sort((a, b) => {
                            const aStart = new Date(a.start_time).getTime();
                            const bStart = new Date(b.start_time).getTime();
                            if (aStart !== bStart) return aStart - bStart;
                            return a.id.localeCompare(b.id);
                          });
                          
                          const indexInGroup = group.findIndex(item => item.id === details.id);
                          const totalCols = group.length;
                          
                          const colWidth = 92 / totalCols;
                          leftPercent = 4 + indexInGroup * colWidth;
                          rightPercent = 100 - (leftPercent + colWidth);
                        }

                        return (
                          <div
                            key={details.id}
                            draggable={true}
                            style={{
                              position: "absolute",
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                              left: `${leftPercent}%`,
                              right: `${rightPercent}%`,
                              WebkitUserDrag: "element"
                            } as React.CSSProperties}
                            onDragStart={(e) => {
                              setDraggedItemId(details.media_item_id);
                              setDraggedOriginEntryId(details.id);
                              e.dataTransfer.setData("text/plain", details.media_item_id);
                              e.dataTransfer.setData("originEntryId", details.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggedItemId(null);
                              setDraggedOriginEntryId(null);
                              setDraggedOverCell(null);
                            }}
                            className={`z-10 rounded border p-2 flex flex-col items-center justify-start transition-all duration-200 select-none group/card text-center overflow-hidden cursor-grab active:cursor-grabbing ${cardStyle} ${
                              hasConflict ? "border-dashed border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.25)]" : ""
                            }`}
                          >
                            {/* Poster thumbnail - enlarged and top-aligned */}
                            <div className="w-full max-w-[100px] aspect-[2/3] bg-black/40 rounded overflow-hidden mb-1.5 border border-white/5 flex items-center justify-center shrink min-h-0 shadow-inner group-hover/card:border-white/20 transition-colors">
                              {details.poster_path ? (
                                <img
                                  src={getPosterUrl(details.poster_path)}
                                  alt={details.item_title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Film size={20} className="opacity-40" />
                              )}
                            </div>

                            {/* Details text - underneath */}
                            <div className="w-full shrink-0 flex flex-col items-center space-y-1">
                              <span className="font-bold text-[10px] text-gray-100 line-clamp-2 leading-tight" title={details.item_title}>
                                {details.item_title}
                              </span>
                              <span className="text-[8.5px] text-gray-400 font-mono block leading-none">
                                {formatTimeStr(entryStart)} - {formatTimeStr(new Date(details.end_time))}
                              </span>
                              <span className="text-[7.5px] uppercase tracking-wider bg-black/40 px-1.5 py-0.5 rounded font-bold text-accent/80 font-mono">
                                {details.media_type}
                              </span>
                            </div>

                            {/* Delete button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEntry(details.id);
                              }}
                              className={`absolute top-1 right-1 p-0.5 rounded text-white/30 transition-colors ${deleteBtnStyle}`}
                              title="Delete entry"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* COLLAPSIBLE SIDEBAR DRAWER */}
      <div 
        className={`bg-panel border-gray-800 flex flex-col justify-between shrink-0 h-full transition-all duration-300 shadow-2xl overflow-hidden ${
          isDrawerOpen ? "w-96 p-6 border-l opacity-100" : "w-0 p-0 border-l-0 opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col h-full justify-between overflow-hidden">
          <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center border-b border-gray-800 pb-3">
              <span className="text-xs font-bold tracking-widest text-accent flex items-center space-x-1.5">
                <Film size={14} />
                <span>COLLECTION ASSETS</span>
              </span>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="text-gray-500 hover:text-gray-200 transition-colors"
                title="Close Drawer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative flex items-center">
              <Search className="absolute left-2.5 text-gray-500" size={14} />
              <input
                type="text"
                placeholder="Search catalog..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveShowName(null);
                }}
                className="w-full bg-gray-950 border border-gray-800 rounded pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-mono"
              />
            </div>

            {/* Scrollable Tag Filters */}
            <div className="flex space-x-1.5 overflow-x-auto w-full scrollbar-none py-1 border-b border-gray-900">
              {libraryTabs.map((tab) => {
                const isSelected = selectedTab === tab;
                const isNotFound = tab === "Not Found";
                let btnStyle = "";
                
                if (isSelected) {
                  if (isNotFound) {
                    btnStyle = "bg-amber-500/15 text-amber-500 border-amber-500/30 font-bold";
                  } else {
                    btnStyle = "bg-accent/15 text-accent border-accent/30 font-bold";
                  }
                } else {
                  if (isNotFound) {
                    btnStyle = "bg-amber-950/5 border border-amber-950/20 text-amber-500/60 hover:text-amber-400";
                  } else {
                    btnStyle = "bg-gray-950 border border-gray-900 text-gray-500 hover:text-gray-300";
                  }
                }

                return (
                  <button
                    key={tab}
                    onClick={() => {
                      setSelectedTab(tab);
                      setActiveShowName(null);
                    }}
                    className={`text-[9px] px-2.5 py-1 rounded transition-all whitespace-nowrap uppercase tracking-wider font-bold ${btnStyle}`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {(() => {
                if (activeShowName) {
                  // Filter episodes specifically for the active show name
                  const showEpisodes = items
                    .filter((details) => details.item.media_type === "Episode" && getShowName(details.item.title) === activeShowName)
                    .sort((a, b) => a.item.title.localeCompare(b.item.title));

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2 border-b border-gray-900 pb-2.5 mb-2.5">
                        <button
                          onClick={() => setActiveShowName(null)}
                          className="text-accent hover:text-accent/80 font-bold text-[10px] flex items-center space-x-1"
                        >
                          <span>←</span> <span>BACK</span>
                        </button>
                        <span className="text-gray-700">|</span>
                        <span className="text-[10px] font-bold text-gray-400 truncate max-w-[200px] uppercase tracking-wider" title={activeShowName}>
                          {activeShowName}
                        </span>
                      </div>

                      {showEpisodes.length === 0 ? (
                        <div className="text-center text-gray-600 text-xs py-10">
                          No episodes found.
                        </div>
                      ) : (
                        showEpisodes.map((details) => {
                          const parsed = parseEpisodeTitle(details.item.title);
                          return (
                            <div
                              key={details.item.id}
                              draggable={true}
                              style={{ WebkitUserDrag: "element" } as React.CSSProperties}
                              onDragStart={(e) => {
                                setDraggedItemId(details.item.id);
                                e.dataTransfer.setData("text/plain", details.item.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDraggedItemId(null);
                                setDraggedOverCell(null);
                              }}
                              className="p-2 bg-gray-950/60 border border-gray-900 rounded transition-colors text-xs flex items-center space-x-3 hover:border-accent/40 cursor-grab active:cursor-grabbing"
                            >
                              <div className="w-16 h-24 bg-gray-950 rounded overflow-hidden shrink-0 flex items-center justify-center border border-gray-900 shadow pointer-events-none">
                                {details.item.poster_path ? (
                                  <img
                                    src={getPosterUrl(details.item.poster_path)}
                                    alt={details.item.title}
                                    className="w-full h-full object-cover pointer-events-none"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="text-gray-700 pointer-events-none">
                                    <Film size={24} />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1 flex flex-col justify-center space-y-0.5 pointer-events-none">
                                <div className="text-[10px] text-gray-400 font-bold truncate pointer-events-none">
                                  {parsed.showName} - S{parsed.season}/E{parsed.episode}
                                </div>
                                <div className="font-bold text-gray-200 text-xs truncate pointer-events-none" title={parsed.epName}>
                                  {parsed.epName}
                                </div>
                                <div className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-wide font-mono pointer-events-none">
                                  EPISODE | {formatRuntime(details.item.runtime)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                }

                // Normal grouped list rendering
                // 1. Filter items based on search query and selected tag
                const filteredItems = items.filter((details) => {
                  const titleMatch = details.item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                     (details.item.original_title && details.item.original_title.toLowerCase().includes(searchQuery.toLowerCase()));
                  
                  let tagMatch = false;
                  if (selectedTab === "All") {
                    tagMatch = true;
                  } else if (selectedTab === "Not Found") {
                    const poster = details.item.poster_path;
                    const hasPoster = poster && (poster.startsWith("http://") || poster.startsWith("https://"));
                    tagMatch = !hasPoster;
                  } else {
                    tagMatch = details.tags.includes(selectedTab);
                  }
                  
                  return titleMatch && tagMatch;
                });

                // 2. Group episodes by TV Show folders (same as in library page)
                const renderList: (MediaItemDetails | { isShowFolder: true; showName: string; episodes: MediaItemDetails[] })[] = [];
                const groupedEpisodes: { [showName: string]: MediaItemDetails[] } = {};

                filteredItems.forEach((details) => {
                  if (details.item.media_type === "Episode") {
                    const showName = getShowName(details.item.title);
                    if (!groupedEpisodes[showName]) {
                      groupedEpisodes[showName] = [];
                    }
                    groupedEpisodes[showName].push(details);
                  } else {
                    renderList.push(details);
                  }
                });

                // Add TV Show folders to the render list
                Object.keys(groupedEpisodes).forEach((showName) => {
                  renderList.push({
                    isShowFolder: true,
                    showName,
                    episodes: groupedEpisodes[showName],
                  });
                });

                if (renderList.length === 0) {
                  return (
                    <div className="h-full flex items-center justify-center text-gray-600 text-xs py-10">
                      No media items found.
                    </div>
                  );
                }

                return renderList.map((entry, idx) => {
                  if ("isShowFolder" in entry) {
                    const group = entry.episodes;
                    const firstItem = group[0];
                    const posterItem = group.find(item => item.item.poster_path);
                    const posterPath = posterItem ? posterItem.item.poster_path : firstItem.item.poster_path;

                    return (
                      <div
                        key={`show_${entry.showName}_${idx}`}
                        onClick={() => setActiveShowName(entry.showName)}
                        className="p-2 bg-gray-950/60 border border-gray-900 rounded transition-colors text-xs flex items-center space-x-3 hover:border-accent/40 cursor-pointer"
                      >
                        <div className="w-16 h-24 bg-gray-950 rounded overflow-hidden shrink-0 flex items-center justify-center border border-gray-900 shadow">
                          {posterPath ? (
                            <img
                              src={getPosterUrl(posterPath)}
                              alt={entry.showName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="text-gray-700">
                              <Folder size={24} className="text-accent/60" />
                            </div>
                          )}
                        </div>
                        <div className="truncate min-w-0 flex-1">
                          <div className="font-bold truncate text-gray-300">{entry.showName}</div>
                          <div className="text-[9px] text-accent mt-0.5 uppercase tracking-wider font-mono font-bold">
                            TV SHOW | {group.length} {group.length === 1 ? "EPISODE" : "EPISODES"}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const details = entry;
                  const isEpisode = details.item.media_type === "Episode";
                  return (
                    <div
                      key={details.item.id}
                      draggable={true}
                      style={{ WebkitUserDrag: "element" } as React.CSSProperties}
                      onDragStart={(e) => {
                        setDraggedItemId(details.item.id);
                        e.dataTransfer.setData("text/plain", details.item.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggedItemId(null);
                        setDraggedOverCell(null);
                      }}
                      className="p-2 bg-gray-950/60 border border-gray-900 rounded transition-colors text-xs flex items-center space-x-3 hover:border-accent/40 cursor-grab active:cursor-grabbing"
                    >
                      <div className="w-16 h-24 bg-gray-950 rounded overflow-hidden shrink-0 flex items-center justify-center border border-gray-900 shadow pointer-events-none">
                        {details.item.poster_path ? (
                          <img
                            src={getPosterUrl(details.item.poster_path)}
                            alt={details.item.title}
                            className="w-full h-full object-cover pointer-events-none"
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-gray-700 pointer-events-none">
                            {isEpisode ? <Film size={24} /> : <Folder size={24} className="text-accent/60" />}
                          </div>
                        )}
                      </div>
                      <div className="truncate min-w-0 flex-1 pointer-events-none">
                        <div className="font-bold truncate text-gray-300 pointer-events-none">{details.item.title}</div>
                        <div className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-wide font-mono pointer-events-none">
                          {details.item.media_type} | {formatRuntime(details.item.runtime)}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
