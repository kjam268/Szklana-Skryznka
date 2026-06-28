import React, { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useChannelStore, usePlayerStore, ScheduleEntryDetails } from "../store";
import { Play, Pause, Volume2, Maximize2, Tv, Clock, Eye, AlertTriangle } from "lucide-react";

export const OnAir: React.FC = () => {
  const { playoutState, fetchPlayoutState, channels, fetchChannels } = useChannelStore();
  const { volume, setVolume, isFullscreen, setFullscreen, isPlaying, setPlaying } = usePlayerStore();
  
  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hoveredItem, setHoveredItem] = useState<ScheduleEntryDetails | null>(null);
  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString("en-US", { hour12: false }));
  const [localProgress, setLocalProgress] = useState(0); // in seconds
  const [remainingTimeStr, setRemainingTimeStr] = useState("00:00:00");
  
  // Load channels on mount
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Sync timer - fetch playout state every 8 seconds, update clock and progress every 1 second
  useEffect(() => {
    const channelId = channels[0]?.id || "chan_default";
    fetchPlayoutState(channelId, new Date().toISOString());

    const fastInterval = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString("en-US", { hour12: false }));
      
      // Manually increment progress locally to avoid excessive IPC overhead
      if (playoutState?.active_entry && videoRef.current) {
        const curTime = videoRef.current.currentTime;
        const dur = videoRef.current.duration || playoutState.active_entry.duration;
        setLocalProgress(curTime);
        
        const rem = Math.max(0, dur - curTime);
        const remH = Math.floor(rem / 3600).toString().padStart(2, "0");
        const remM = Math.floor((rem % 3600) / 60).toString().padStart(2, "0");
        const remS = Math.floor(rem % 60).toString().padStart(2, "0");
        setRemainingTimeStr(`${remH}:${remM}:${remS}`);
      }
    }, 1000);

    const slowInterval = setInterval(() => {
      fetchPlayoutState(channelId, new Date().toISOString());
    }, 8000);

    return () => {
      clearInterval(fastInterval);
      clearInterval(slowInterval);
    };
  }, [channels, playoutState?.active_entry?.id, fetchPlayoutState]);

  // Trigger seek on playoutState sync or when video metadata loads
  useEffect(() => {
    if (playoutState?.active_entry && videoRef.current) {
      const targetSec = playoutState.playout_position_ms / 1000;
      const currentVideoTime = videoRef.current.currentTime;

      // Seek if difference is significant (> 1.5 seconds) to avoid jitter
      if (Math.abs(currentVideoTime - targetSec) > 1.5) {
        videoRef.current.currentTime = targetSec;
      }
      
      // Auto play
      videoRef.current.play()
        .then(() => setPlaying(true))
        .catch((err) => {
          console.warn("Autoplay blocked by browser policy: ", err);
          setPlaying(false);
        });
    } else {
      setPlaying(false);
    }
  }, [playoutState?.active_entry?.id]);

  const activeEntry = playoutState?.active_entry;
  const nextEntry = playoutState?.next_entry;

  const formatRuntime = (runtimeSec: number) => {
    const minutes = Math.round(runtimeSec / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, "0")}m`;
    }
    return `${m}m`;
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (!document.fullscreenElement) {
        videoRef.current.requestFullscreen().then(() => setFullscreen(true));
      } else {
        document.exitFullscreen();
        setFullscreen(false);
      }
    }
  };

  return (
    <div className="flex-1 h-screen flex bg-background text-gray-200 font-mono">
      {/* LEFT PANEL: BROADCAST SCHEDULE TIMELINE */}
      <div className="w-1/2 border-r border-gray-800 flex flex-col justify-between p-6 bg-background relative overflow-hidden">
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-onair animate-pulse orange-glow" />
              <span className="text-sm font-bold tracking-widest text-onair">ON AIR PROGRAMMING</span>
            </div>
            <div className="flex items-center space-x-2 bg-gray-900 border border-gray-800 px-3 py-1 rounded">
              <Clock size={14} className="text-accent" />
              <span className="text-xs text-accent font-bold">{timeStr}</span>
            </div>
          </div>

          {/* Timeline Stack */}
          <div className="space-y-3 h-[calc(100vh-280px)] overflow-y-auto pr-2">
            {activeEntry && (
              <div 
                className="p-4 bg-onair/5 border border-onair/30 rounded-lg hover:border-onair relative transition-all duration-200"
                onMouseEnter={() => setHoveredItem(activeEntry)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <div className="absolute top-2 right-3 text-[9px] font-bold text-onair bg-onair/20 px-1.5 py-0.5 rounded tracking-widest animate-pulse">
                  ON AIR NOW
                </div>
                <div className="text-xs text-gray-500 font-bold mb-1">
                  {new Date(activeEntry.start_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })} - {new Date(activeEntry.end_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
                <div className="text-sm font-bold text-gray-100">{activeEntry.item_title}</div>
                <div className="text-[10px] text-gray-400 mt-1 flex space-x-3">
                  <span>TYPE: {activeEntry.media_type.toUpperCase()}</span>
                  <span>DURATION: {formatRuntime(activeEntry.duration)}</span>
                </div>
              </div>
            )}

            {!activeEntry && (
              <div className="p-8 bg-gray-950 border border-dashed border-gray-800 rounded-lg text-center text-gray-500 text-xs flex flex-col items-center justify-center space-y-2">
                <AlertTriangle className="text-onair" size={20} />
                <span>NO LIVE CONTENT SCHEDULED - STATION STANDBY</span>
              </div>
            )}

            {nextEntry && (
              <div 
                className="p-4 bg-panel border border-gray-800 rounded-lg hover:border-accent/40 relative transition-all duration-200"
                onMouseEnter={() => setHoveredItem(nextEntry)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <div className="text-xs text-gray-500 font-bold mb-1">
                  {new Date(nextEntry.start_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })} - {new Date(nextEntry.end_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
                <div className="text-sm font-bold text-gray-300">{nextEntry.item_title}</div>
                <div className="text-[10px] text-gray-500 mt-1 flex space-x-3">
                  <span>TYPE: {nextEntry.media_type.toUpperCase()}</span>
                  <span>DURATION: {formatRuntime(nextEntry.duration)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Hover detail panel */}
        <div className="bg-panel border border-gray-800 rounded-lg p-4 h-40 flex items-center space-x-4 relative">
          <div className="absolute top-2 right-4 text-[9px] text-gray-600">INSPECT BLOCK</div>
          {hoveredItem ? (
            <div className="flex items-center space-x-4 w-full">
              {hoveredItem.poster_path ? (
                <img 
                  src={getPosterUrl(hoveredItem.poster_path)} 
                  alt="Poster" 
                  className="w-16 h-24 object-cover rounded border border-gray-700 bg-gray-900"
                />
              ) : (
                <div className="w-16 h-24 bg-gray-900 border border-gray-800 flex items-center justify-center rounded text-gray-600">
                  <Tv size={20} />
                </div>
              )}
              <div className="flex-1 space-y-1">
                <div className="text-sm font-bold text-accent">{hoveredItem.item_title}</div>
                <p className="text-[10px] text-gray-400 line-clamp-3 leading-relaxed">
                  {hoveredItem.explanation || "Manually scheduled block."}
                </p>
                <div className="text-[9px] text-gray-500">
                  TYPE: {hoveredItem.media_type} | RUNTIME: {formatRuntime(hoveredItem.duration)}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-600 text-xs w-full py-4">
              Hover over a schedule block to inspect program metadata details
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: MAIN VIDEO playout MONITOR */}
      <div className="w-1/2 flex flex-col justify-between p-6 bg-gray-950">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <span className="text-xs uppercase tracking-widest text-gray-500 font-bold">BROADCAST MONITOR</span>
          <div className="flex items-center space-x-1 text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded text-[10px] border border-emerald-500/20">
            <Eye size={12} />
            <span>STATISTICS: STABLE</span>
          </div>
        </div>

        {/* Professional Video Playout Box */}
        <div className="aspect-video w-full bg-black rounded-lg border border-gray-800 relative overflow-hidden flex items-center justify-center group shadow-2xl">
          {activeEntry?.file_path ? (
            <>
              <video
                ref={videoRef}
                src={convertFileSrc(activeEntry.file_path)}
                className="w-full h-full object-contain"
                volume={volume}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                  // Instantly sync next program
                  const channelId = channels[0]?.id || "chan_default";
                  fetchPlayoutState(channelId, new Date().toISOString());
                }}
              />
              {!isPlaying && (
                <div 
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.play()
                        .then(() => setPlaying(true))
                        .catch((err) => console.warn("Playout activation failed:", err));
                    }
                  }}
                  className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center cursor-pointer z-30 space-y-2 hover:bg-black/60 transition-colors pointer-events-auto"
                >
                  <div className="text-onair text-xs font-bold tracking-widest animate-pulse border border-onair/30 px-4 py-2 rounded bg-black/80 flex items-center space-x-2">
                    <Play size={14} className="fill-onair" />
                    <span>START MONITOR FEED (CLICK TO SYNC)</span>
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono">Autoplay policy requires user activation.</div>
                </div>
              )}
            </>
          ) : (
            // STATION STANDBY: SMPTE Color Bars
            <div className="w-full h-full relative flex flex-col justify-between p-8 font-mono bg-zinc-900 border border-zinc-800 overflow-hidden">
              {/* SMPTE color bars pattern simulation */}
              <div className="absolute inset-0 flex flex-col opacity-60 pointer-events-none">
                <div className="h-2/3 flex">
                  <div className="flex-1 bg-gray-200" />
                  <div className="flex-1 bg-yellow-400" />
                  <div className="flex-1 bg-cyan-400" />
                  <div className="flex-1 bg-green-500" />
                  <div className="flex-1 bg-magenta-500" style={{ backgroundColor: '#ec4899' }} />
                  <div className="flex-1 bg-red-600" />
                  <div className="flex-1 bg-blue-700" />
                </div>
                <div className="h-1/6 flex">
                  <div className="flex-1 bg-blue-700" />
                  <div className="flex-1 bg-zinc-900" />
                  <div className="flex-1 bg-magenta-500" style={{ backgroundColor: '#ec4899' }} />
                  <div className="flex-1 bg-zinc-900" />
                  <div className="flex-1 bg-cyan-400" />
                  <div className="flex-1 bg-zinc-900" />
                  <div className="flex-1 bg-gray-200" />
                </div>
                <div className="h-1/6 flex">
                  <div className="flex-[2.5] bg-zinc-950" />
                  <div className="flex-[1.5] bg-white" />
                  <div className="flex-[3] bg-zinc-950" />
                </div>
              </div>
              
              <div className="z-10 bg-black/80 p-4 border border-gray-800 rounded max-w-sm mx-auto my-auto text-center space-y-3">
                <div className="text-onair font-bold tracking-widest text-sm animate-pulse">NO LIVE PLayout</div>
                <div className="text-[10px] text-gray-400">
                  Fill gaps using the EPG Scheduler or apply a Channel profile.
                </div>
                {nextEntry && (
                  <div className="text-[10px] text-accent mt-2">
                    Next program starts in: {Math.round((new Date(nextEntry.start_time).getTime() - new Date().getTime()) / 60000)}m
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video overlay dashboard panel (appears on hover) */}
          {activeEntry && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              <div className="flex justify-between items-center text-xs text-gray-300 mb-2">
                <span>{activeEntry.item_title}</span>
                <span>{remainingTimeStr} remaining</span>
              </div>
              {/* Seek is locked */}
              <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden mb-3">
                <div 
                  className="h-full bg-accent"
                  style={{ 
                    width: `${
                      videoRef.current?.duration 
                        ? (localProgress / videoRef.current.duration) * 100 
                        : 0
                    }%` 
                  }}
                />
              </div>
              
              {/* Playback monitor stats */}
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-4 pointer-events-auto">
                  <span className="text-[10px] text-gray-500 font-mono">SEEK CONTROLS LOCKED (LIVE TV MODE)</span>
                </div>
                <div className="flex items-center space-x-2 pointer-events-auto">
                  <Volume2 size={16} className="text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <button 
                    onClick={handleFullscreen}
                    className="text-gray-400 hover:text-accent focus:outline-none"
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Current Active details stats */}
        <div className="bg-panel border border-gray-800 rounded-lg p-5 space-y-3 relative">
          <div className="absolute top-2 right-4 text-[9px] text-gray-600">LIVE FEED TELEMETRY</div>
          {activeEntry ? (
            <div className="space-y-2">
              <div className="text-sm font-bold text-accent">{activeEntry.item_title}</div>
              <div className="grid grid-cols-2 gap-y-2 text-[10px] text-gray-400">
                <div>VIDEO CODEC: <span className="text-gray-200 font-bold">{activeEntry.file_path ? "h264/avc" : "NONE"}</span></div>
                <div>RESOLUTION: <span className="text-gray-200 font-bold">1080p (1920x1080)</span></div>
                <div>PLAYBACK POSITION: <span className="text-gray-200 font-bold">{Math.round(localProgress)}s / {activeEntry.duration}s</span></div>
                <div>TYPE: <span className="text-gray-200 font-bold">{activeEntry.media_type.toUpperCase()}</span></div>
              </div>
              <div className="pt-2 border-t border-gray-800 flex justify-between items-center text-[10px] text-gray-500">
                <span>NEXT UP: {nextEntry ? nextEntry.item_title : "STATION STANDBY"}</span>
                <span>{nextEntry ? new Date(nextEntry.start_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false }) : ""}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-600 text-xs">
              Playout Feed Offline. No schedule telemetry to display.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
