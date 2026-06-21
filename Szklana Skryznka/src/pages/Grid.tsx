import React, { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { useLibraryStore, useScheduleStore, useChannelStore, MediaItemDetails, ScheduleEntryDetails } from "../store";
import { Calendar, Clock, Plus, Zap, AlertCircle, LayoutGrid, CheckCircle2, Sliders, ChevronLeft, ChevronRight } from "lucide-react";

export const Grid: React.FC = () => {
  const { items, fetchItems } = useLibraryStore();
  const { entries, fetchEntries, selectedProfile, setSelectedProfile, selectedPolicy, setSelectedPolicy, generateSchedule } = useScheduleStore();
  const { channels, fetchChannels } = useChannelStore();
  
  // Snap rolling week to start on the current week's Monday at 07:00
  const [startOfWeek, setStartOfWeek] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(7, 0, 0, 0);
    return monday;
  });

  // Drag over target cell state
  const [dragOverCell, setDragOverCell] = useState<{ dayIdx: number; hourIdx: number } | null>(null);

  // Manual scheduler modal state
  const [isSchedModalOpen, setIsSchedModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItemDetails | null>(null);
  const [selectedSlotDate, setSelectedSlotDate] = useState<Date | null>(null);
  const [schedHour, setSchedHour] = useState("20");
  const [schedMin, setSchedMin] = useState("00");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const formatRuntime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, "0")}m`;
    }
    return `${m}m`;
  };

  const channelId = channels[0]?.id || "chan_default";

  // Calculate 7 rolling days of the week starting from Monday (startOfWeek)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const loadScheduleData = async () => {
    const startIso = startOfWeek.toISOString();
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const endIso = endOfWeek.toISOString();
    
    await fetchEntries(channelId, startIso, endIso);
  };

  useEffect(() => {
    fetchItems();
    fetchChannels();
  }, [fetchItems, fetchChannels]);

  useEffect(() => {
    if (channelId) {
      loadScheduleData();
    }
  }, [startOfWeek, channelId]);

  // Adjust start of week by +/- 7 days (snaps to Monday)
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

  // Convert 30-minute slot to start & end datetimes relative to dayDate (e.g. 7 AM to 7 AM next day)
  const getSlotDateTimeRange = (dayDate: Date, slotIndex: number) => {
    const slotStart = new Date(dayDate);
    const totalMinutes = 7 * 60 + slotIndex * 30;
    const hour = Math.floor((totalMinutes / 60) % 24);
    const minute = totalMinutes % 60;
    
    // Check if slot falls on the next calendar day
    const calendarDayOffset = Math.floor(totalMinutes / (24 * 60));
    if (calendarDayOffset > 0) {
      slotStart.setDate(slotStart.getDate() + calendarDayOffset);
    }
    
    slotStart.setHours(hour, minute, 0, 0);
    
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotStart.getMinutes() + 30);
    return { start: slotStart, end: slotEnd };
  };

  return (
    <div className="flex-1 h-screen flex bg-background text-gray-200 font-mono overflow-hidden">
      {/* LEFT PORTION: TIMELINE CANVAS */}
      <div className="flex-1 flex flex-col justify-between p-6 overflow-hidden">
        {/* Timeline Header Controls */}
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-800 pb-3">
            <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
              <Calendar size={16} className="text-accent" />
              <span>THE GRID WEEKLY SCHEDULE (MON - MON)</span>
            </span>
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
          </div>
        </div>

        {/* TIMELINE LIST CANVAS */}
        <div className="flex-1 overflow-y-auto mt-6 border border-gray-800 bg-gray-950 rounded-lg shadow-inner flex flex-row">
          
          {/* LEFT: STATIC TIME INDICATORS COLUMN (fixed horizontally, scrolls vertically with container) */}
          <div className="w-20 shrink-0 flex flex-col bg-gray-950 border-r border-gray-800 select-none">
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
              if (hour >= 7 && hour < 12) {
                labelColor = "text-cyan-500/80";
                labelText = "MORNING";
              } else if (hour >= 12 && hour < 17) {
                labelColor = "text-amber-500/80";
                labelText = "AFTERNOON";
              } else if (hour >= 17 && hour < 22) {
                labelColor = "text-orange-500/80";
                labelText = "EVENING";
              } else {
                labelColor = "text-indigo-400/80";
                labelText = "NIGHT";
              }

              return (
                <div key={slotIdx} className="h-[64px] shrink-0 border-b border-gray-900/50 flex flex-col items-center justify-center space-y-0.5 bg-gray-950">
                  <span className="text-[11px] font-bold text-gray-400">{hourStr}</span>
                  <span className={`text-[7px] font-bold tracking-widest ${labelColor}`}>{labelText}</span>
                </div>
              );
            })}
          </div>

          {/* RIGHT: SCROLLABLE DAYS GRID */}
          <div className="flex-1 overflow-x-auto">
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
              <div className="flex flex-col">
                {Array.from({ length: 48 }, (_, slotIdx) => {
                  const hourIdx = Math.floor(slotIdx / 2);
                  const isHalfHour = slotIdx % 2 === 1;
                  const hour = (7 + hourIdx) % 24;

                  let blockColor = "";
                  if (hour >= 7 && hour < 12) {
                    blockColor = "bg-cyan-950/10 border-cyan-800/10 hover:bg-cyan-950/20";
                  } else if (hour >= 12 && hour < 17) {
                    blockColor = "bg-amber-950/10 border-amber-800/10 hover:bg-amber-950/20";
                  } else if (hour >= 17 && hour < 22) {
                    blockColor = "bg-orange-950/10 border-orange-800/10 hover:bg-orange-950/20";
                  } else {
                    blockColor = "bg-indigo-950/10 border-indigo-900/10 hover:bg-indigo-950/20";
                  }

                  return (
                    <div key={slotIdx} className="flex border-b border-gray-900/50 h-[64px] shrink-0">
                      {weekDays.map((dayDate, dayIdx) => {
                        const { start: slotStart, end: slotEnd } = getSlotDateTimeRange(dayDate, slotIdx);
                        
                        // Check for schedule entries overlapping this time block
                        const slotEntries = entries.filter((e) => {
                          const estart = new Date(e.start_time);
                          const eend = new Date(e.end_time);
                          return estart < slotEnd && eend > slotStart;
                        });

                        const hasContent = slotEntries.length > 0;
                        const isDraggedOver = dragOverCell?.dayIdx === dayIdx && dragOverCell?.hourIdx === slotIdx;

                        return (
                          <div 
                            key={dayIdx}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              setDragOverCell({ dayIdx, hourIdx: slotIdx });
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "copy";
                              setDragOverCell({ dayIdx, hourIdx: slotIdx });
                            }}
                            onDragLeave={() => {
                              setDragOverCell(null);
                            }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              setDragOverCell(null);
                              const itemId = e.dataTransfer.getData("text/plain") || draggedItemId;
                              setDraggedItemId(null);
                              if (!itemId) return;

                              try {
                                await invoke("create_schedule", {
                                  channelId,
                                  mediaItemId: itemId,
                                  startTimeIso: slotStart.toISOString(),
                                  isLocked: true,
                                  explanation: "Manually drag-and-drop programmed block"
                                });
                                loadScheduleData();
                              } catch (err) {
                                alert(`Failed to schedule item: ${err}`);
                              }
                            }}
                            onClick={async () => {
                              if (draggedItemId) {
                                try {
                                  await invoke("create_schedule", {
                                    channelId,
                                    mediaItemId: draggedItemId,
                                    startTimeIso: slotStart.toISOString(),
                                    isLocked: true,
                                    explanation: "Manually programmed block via selection click"
                                  });
                                  loadScheduleData();
                                  setDraggedItemId(null);
                                } catch (err) {
                                  alert(`Failed to schedule item: ${err}`);
                                }
                              }
                            }}
                            className={`flex-1 border-r border-gray-900 p-2 flex flex-col justify-between transition-all duration-150 overflow-hidden relative cursor-pointer ${blockColor}`}
                          >
                            {isDraggedOver && (
                              <div className="absolute inset-0 bg-accent/20 border-2 border-accent border-dashed pointer-events-none z-20 animate-pulse" />
                            )}
                            <div className={`flex-1 overflow-y-auto space-y-1 pr-0.5 scrollbar-none ${draggedItemId ? "pointer-events-none" : ""}`}>
                              {hasContent ? (
                                slotEntries.map((e) => {
                                  const isLocked = e.is_locked === 1;
                                  return (
                                    <div 
                                      key={e.id} 
                                      className={`p-1.5 rounded text-[10px] border leading-tight ${
                                        isLocked 
                                          ? "bg-cyan-950/40 border-accent/40 text-accent font-sans" 
                                          : "bg-panel border-gray-800 text-gray-300 font-sans"
                                      }`}
                                      title={`${e.item_title} (${e.media_type})\nStart: ${new Date(e.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}\nEnd: ${new Date(e.end_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                                    >
                                      <div className="font-bold truncate text-[10px]">{e.item_title}</div>
                                      <div className="text-[8px] text-gray-500 flex justify-between mt-0.5 font-mono">
                                        <span>{e.media_type.toUpperCase()}</span>
                                        <span>{formatRuntime(e.duration)}</span>
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center text-gray-700 py-1 select-none">
                                  <AlertCircle size={10} className="text-gray-800 mb-0.5" />
                                  <span className="text-[8px] tracking-wider font-bold">DEAD AIR GAP</span>
                                </div>
                              )}
                            </div>

                            {/* Action footer */}
                            <div className={`flex justify-between items-center mt-1 pt-1 border-t border-gray-900/30 ${draggedItemId ? "pointer-events-none" : ""}`}>
                              {hasContent ? (
                                <span className="text-[8px] text-gray-600 font-mono">
                                  {slotEntries.length} BLOCKS
                                </span>
                              ) : (
                                <span className="text-[8px] text-gray-700 font-mono select-none">
                                  STANDBY
                                </span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSchedHour(hour.toString().padStart(2, "0"));
                                  setSchedMin(isHalfHour ? "30" : "00");
                                  setSelectedSlotDate(dayDate);
                                  setIsSchedModalOpen(true);
                                }}
                                className="text-[8px] text-gray-500 hover:text-accent font-bold px-1 py-0.5 rounded bg-gray-900/50 border border-gray-800 hover:border-accent transition-colors pointer-events-auto"
                              >
                                + ADD
                              </button>
                            </div>
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

      {/* RIGHT SIDEBAR: DRAG/CLICK SCHEDULER LIBRARY PANEL */}
      <div className="w-80 bg-panel border-l border-gray-800 flex flex-col justify-between p-6 shrink-0">
        <div className="flex flex-col h-full justify-between overflow-hidden">
          <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center border-b border-gray-800 pb-3">
              <span className="text-xs font-bold tracking-widest text-accent flex items-center space-x-1.5">
                <LayoutGrid size={14} />
                <span>LIBRARY SELECTOR</span>
              </span>
            </div>
            
            <p className="text-[10px] text-gray-500 leading-relaxed">
              DRAG assets from the list below and DROP them directly onto any timeline hour slot to schedule programming instantly.
            </p>

            <div className="relative">
              <input
                type="text"
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent text-accent font-mono"
              />
            </div>

            {draggedItemId && (
              <div className="bg-accent/15 border border-accent/30 rounded p-2 text-[10px] text-accent font-bold animate-pulse flex justify-between items-center">
                <span>SELECT MODE ACTIVE: Click slot to program</span>
                <button onClick={() => setDraggedItemId(null)} className="hover:text-white uppercase font-bold text-[8px] border border-accent/20 px-1 rounded">Cancel</button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {items
                .filter((details) => {
                  const q = searchQuery.toLowerCase().trim();
                  if (!q) return true;
                  return details.item.title.toLowerCase().includes(q) || details.item.media_type.toLowerCase().includes(q);
                })
                .map((details) => {
                  const isSelected = draggedItemId === details.item.id;
                  return (
                    <div
                      key={details.item.id}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData("text/plain", details.item.id);
                        setDraggedItemId(details.item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedItemId(null);
                      }}
                      onClick={() => {
                        if (isSelected) {
                          setDraggedItemId(null);
                        } else {
                          setDraggedItemId(details.item.id);
                        }
                      }}
                      className={`p-2.5 bg-gray-950 border rounded cursor-pointer transition-colors text-xs flex justify-between items-center group active:scale-[0.98] select-none ${
                        isSelected ? "border-accent bg-accent/10 cyan-glow" : "border-gray-800 hover:border-accent"
                      }`}
                      title="Drag me or click to select and schedule!"
                    >
                      <div className="truncate pr-2">
                        <div className={`font-bold truncate group-hover:text-accent ${isSelected ? "text-accent" : "text-gray-300"}`}>{details.item.title}</div>
                        <div className="text-[9px] text-gray-500 mt-0.5">
                          {details.item.media_type.toUpperCase()} | {formatRuntime(details.item.runtime)}
                        </div>
                      </div>
                      <div className={`border px-2 py-1 rounded text-[9px] font-bold transition-colors shrink-0 ${
                        isSelected 
                          ? "bg-accent text-background border-accent" 
                          : "bg-gray-900 border-gray-800 text-gray-500 group-hover:text-accent"
                      }`}>
                        {isSelected ? "SELECTED" : "DRAG/CLICK"}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* MANUAL SCHEDULING POPUP DIALOG */}
      {isSchedModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-panel border border-gray-800 max-w-sm w-full rounded-lg p-6 space-y-4 font-mono">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <span className="text-xs font-bold text-accent">PROGRAM BLOCK SETTINGS</span>
              <button 
                onClick={() => {
                  setIsSchedModalOpen(false);
                  setSelectedItem(null);
                }}
                className="text-gray-500 hover:text-gray-200 text-xs font-bold"
              >
                CANCEL
              </button>
            </div>
            
            {/* Select catalog asset */}
            {!selectedItem ? (
              <div className="space-y-2">
                <label className="text-[10px] text-gray-500">SELECT CATALOG ASSET</label>
                <select
                  onChange={(e) => {
                    const selected = items.find((i) => i.item.id === e.target.value);
                    if (selected) setSelectedItem(selected);
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-accent text-xs font-bold"
                  defaultValue=""
                >
                  <option value="" disabled>-- Select Media Item --</option>
                  {items.map((it) => (
                    <option key={it.item.id} value={it.item.id}>
                      {it.item.title} ({it.item.media_type})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="text-xs text-gray-400 leading-relaxed">
                Scheduling: <span className="text-gray-100 font-bold">{selectedItem.item.title}</span> ({formatRuntime(selectedItem.item.runtime)}).
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">TARGET DATE</label>
                <select
                  value={selectedSlotDate?.toISOString() || ""}
                  onChange={(e) => setSelectedSlotDate(new Date(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-accent font-bold"
                >
                  {weekDays.map((day, idx) => (
                    <option key={idx} value={day.toISOString()}>
                      {day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500">START HOUR (00 - 23)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={schedHour}
                    onChange={(e) => setSchedHour(e.target.value.padStart(2, "0"))}
                    className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-accent font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500">START MINUTE (00 - 59)</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={schedMin}
                    onChange={(e) => setSchedMin(e.target.value.padStart(2, "0"))}
                    className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-accent font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={async () => {
                  if (!selectedItem) {
                    alert("Please select a media item to schedule.");
                    return;
                  }
                  try {
                    const targetDate = selectedSlotDate || startOfWeek;
                    const startIso = new Date(targetDate);
                    
                    const hr = parseInt(schedHour);
                    const mn = parseInt(schedMin);
                    startIso.setHours(hr, mn, 0, 0);
                    
                    await invoke("create_schedule", {
                      channelId,
                      mediaItemId: selectedItem.item.id,
                      startTimeIso: startIso.toISOString(),
                      isLocked: true,
                      explanation: "Manually programmed block by the operator"
                    });
                    
                    setIsSchedModalOpen(false);
                    setSelectedItem(null);
                    alert("Block scheduled successfully!");
                    loadScheduleData();
                  } catch (e) {
                    alert(e);
                  }
                }}
                className="w-full bg-accent text-background font-bold text-xs py-2 rounded hover:bg-cyan-400 transition-colors"
              >
                CONFIRM AND SCHEDULE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
