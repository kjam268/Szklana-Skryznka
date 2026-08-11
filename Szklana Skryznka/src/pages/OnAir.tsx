import React, { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useChannelStore, ScheduleEntryDetails } from "../store";
import { Clock, Eye, AlertTriangle, PlayCircle, StopCircle, RefreshCw, Globe, Subtitles, ChevronDown, Check } from "lucide-react";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface SubtitleRecord {
  id: string;
  media_item_id: string;
  language: string;
  subtitle_type: string;
  file_path: string;
  is_default: number;
}

function parseSrtToCues(srtText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = srtText.trim().split(/\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length >= 2) {
      const timeLine = lines.find((l) => l.includes("-->"));
      if (timeLine) {
        const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
        const parseSec = (str: string) => {
          const parts = str.replace(",", ".").split(":");
          if (parts.length === 3) {
            return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
          }
          return 0;
        };
        const start = parseSec(startStr);
        const end = parseSec(endStr);
        const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(l => !/^\d+$/.test(l.trim())).join("\n");
        if (textLines) {
          cues.push({ start, end, text: textLines });
        }
      }
    }
  }
  return cues;
}

function srtToVttBlobUrl(srtText: string): string {
  const vttText = "WEBVTT\n\n" + srtText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  const blob = new Blob([vttText], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}

export const OnAir: React.FC = () => {
  const { playoutState, fetchPlayoutState, channels, fetchChannels } = useChannelStore();
  const [vlcActive, setVlcActive] = useState(false);
  const [hlsSrc, setHlsSrc] = useState<string>("");
  
  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };

  const getFallbackPosterUrl = (itemId: string) => {
    let hash = 0;
    for (let i = 0; i < itemId.length; i++) {
      hash = itemId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % 37;
    return index === 36 ? "/no_poster.png" : `/no_poster${index}.png`;
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hoveredItem, setHoveredItem] = useState<ScheduleEntryDetails | null>(null);
  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString("en-US", { hour12: false }));
  const [localProgress, setLocalProgress] = useState(0); // in seconds
  const [remainingTimeStr, setRemainingTimeStr] = useState("00:00:00");
  const [comingPrograms, setComingPrograms] = useState<ScheduleEntryDetails[]>([]);
  const [showBackToLive, setShowBackToLive] = useState(false);

  // Subtitles & Audio Track state
  const [subtitles, setSubtitles] = useState<SubtitleRecord[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("off");
  const [currentCues, setCurrentCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string>("");
  const [vttTrackUrl, setVttTrackUrl] = useState<string>("");
  const [showSubMenu, setShowSubMenu] = useState(false);

  const [availableAudioTracks, setAvailableAudioTracks] = useState<string[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string>("default");
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [forceVlcMode, setForceVlcMode] = useState(false);

  const activeEntry = playoutState?.active_entry;
  const nextEntry = playoutState?.next_entry;

  const isAudioOnly = activeEntry?.file_path
    ? (activeEntry.file_path.toLowerCase().endsWith(".mp3") ||
       activeEntry.file_path.toLowerCase().endsWith(".aac") ||
       activeEntry.file_path.toLowerCase().endsWith(".wav") ||
       activeEntry.file_path.toLowerCase().endsWith(".flac"))
    : false;

  const isWebCompatible = isAudioOnly && !forceVlcMode;

  useEffect(() => {
    setForceVlcMode(false);
  }, [activeEntry?.id]);
  
  // Load channels on mount
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Load coming programs for today (starting from 00:00:00 to 23:59:59)
  useEffect(() => {
    const fetchComing = async () => {
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const startIso = start.toISOString();
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const endIso = end.toISOString();

        const channelId = channels[0]?.id || "chan_default";
        const fetched = await invoke<ScheduleEntryDetails[]>("get_schedule_entries", {
          channelId,
          startTimeIso: startIso,
          endTimeIso: endIso,
        });

        fetched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        setComingPrograms(fetched);
      } catch (err) {
        console.error("Failed to fetch coming programs:", err);
      }
    };

    fetchComing();
    const interval = setInterval(fetchComing, 15000);
    return () => clearInterval(interval);
  }, [channels, playoutState?.active_entry?.id]);

  // Fetch subtitles and audio tracks for active item
  useEffect(() => {
    if (!activeEntry?.media_item_id) {
      setSubtitles([]);
      setSelectedSubtitleId("off");
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      setAvailableAudioTracks([]);
      return;
    }

    invoke<SubtitleRecord[]>("get_subtitles", { mediaItemId: activeEntry.media_item_id })
      .then((res) => {
        setSubtitles(res || []);
        const defaultSub = res?.find(s => s.is_default === 1) || res?.[0];
        if (defaultSub) {
          setSelectedSubtitleId(defaultSub.id);
        } else {
          setSelectedSubtitleId("off");
        }
      })
      .catch((err) => {
        console.error("Failed to fetch subtitles:", err);
        setSubtitles([]);
      });

    // Parse audio tracks
    const tracks: string[] = [];
    if (activeEntry.audio_language) {
      tracks.push(activeEntry.audio_language.toUpperCase());
    }
    if (activeEntry.audio_tracks) {
      const splitTracks = activeEntry.audio_tracks.split(",").map(t => t.trim());
      splitTracks.forEach(t => {
        if (t && !tracks.includes(t)) tracks.push(t);
      });
    }
    if (tracks.length === 0) {
      tracks.push("Stereo (Default)");
    }
    setAvailableAudioTracks(tracks);
    setSelectedAudioTrack(tracks[0]);
  }, [activeEntry?.media_item_id]);

  // Load and parse selected subtitle track
  useEffect(() => {
    if (selectedSubtitleId === "off" || !selectedSubtitleId) {
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      return;
    }

    const sub = subtitles.find(s => s.id === selectedSubtitleId);
    if (!sub || !sub.file_path) {
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      return;
    }

    const fileUrl = convertFileSrc(sub.file_path);
    fetch(fileUrl)
      .then(res => res.text())
      .then(text => {
        const cues = parseSrtToCues(text);
        setCurrentCues(cues);
        const vttUrl = srtToVttBlobUrl(text);
        setVttTrackUrl(vttUrl);
      })
      .catch(err => {
        console.error("Failed to load subtitle file:", err);
        setCurrentCues([]);
        setVttTrackUrl("");
      });
  }, [selectedSubtitleId, subtitles]);

  // Update active subtitle cue text on playback tick
  useEffect(() => {
    if (currentCues.length === 0) {
      setActiveCueText("");
      return;
    }
    const match = currentCues.find(c => localProgress >= c.start && localProgress <= c.end);
    setActiveCueText(match ? match.text : "");
  }, [localProgress, currentCues]);

  // Handle audio track change
  const handleAudioTrackSelect = (trackName: string) => {
    setSelectedAudioTrack(trackName);
    setShowAudioMenu(false);
    if (videoRef.current && (videoRef.current as any).audioTracks) {
      const audioTracks = (videoRef.current as any).audioTracks;
      for (let i = 0; i < audioTracks.length; i++) {
        audioTracks[i].enabled = (i === availableAudioTracks.indexOf(trackName));
      }
    }
  };

  // Sync timer - fetch playout state every 8 seconds, update clock and progress every 1 second
  useEffect(() => {
    const channelId = channels[0]?.id || "chan_default";
    fetchPlayoutState(channelId, new Date().toISOString());

    const fastInterval = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString("en-US", { hour12: false }));
      
      if (playoutState?.active_entry) {
        const startMs = new Date(playoutState.active_entry.start_time).getTime();
        const nowMs = new Date().getTime();
        const elapsedSec = Math.max(0, (nowMs - startMs) / 1000);
        
        const dur = playoutState.active_entry.duration;
        setLocalProgress(elapsedSec);
        
        const rem = Math.max(0, dur - elapsedSec);
        const remH = Math.floor(rem / 3600).toString().padStart(2, "0");
        const remM = Math.floor((rem % 3600) / 60).toString().padStart(2, "0");
        const remS = Math.floor(rem % 60).toString().padStart(2, "0");
        setRemainingTimeStr(`${remH}:${remM}:${remS}`);

        // Sync native seek deviation check
        if (isWebCompatible && videoRef.current && playoutState.playout_position_ms) {
          const targetSec = playoutState.playout_position_ms / 1000;
          const cur = videoRef.current.currentTime;
          if (Math.abs(cur - targetSec) > 3.0) {
            setShowBackToLive(true);
          } else {
            setShowBackToLive(false);
          }
        } else {
          setShowBackToLive(false);
        }
      }
    }, 1000);

    const slowInterval = setInterval(() => {
      fetchPlayoutState(channelId, new Date().toISOString());
    }, 8000);

    return () => {
      clearInterval(fastInterval);
      clearInterval(slowInterval);
    };
  }, [channels, playoutState?.active_entry?.id, fetchPlayoutState, isWebCompatible]);

  // Clean up transcoder on unmount
  useEffect(() => {
    return () => {
      invoke("stop_transcode").catch((err) => console.error("Transcoder unmount cleanup failed:", err));
    };
  }, []);

  const currentPlayingFileRef = useRef<string | null>(null);

  // Trigger VLC launch/update when active_entry changes and VLC mode is enabled for non-compatible files
  useEffect(() => {
    const activeFilePath = playoutState?.active_entry?.file_path;
    if (vlcActive && activeFilePath) {
      if (!isWebCompatible) {
        if (currentPlayingFileRef.current === activeFilePath && hlsSrc) {
          return;
        }
        currentPlayingFileRef.current = activeFilePath;
        const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
        invoke<string>("start_transcode", {
          filePath: activeFilePath,
          startTimeSec: targetSec
        })
        .then(() => {
          setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}`);
        })
        .catch((err) => {
          console.warn("Transcoder launch failed:", err);
          setHlsSrc("");
        });
      } else {
        currentPlayingFileRef.current = null;
        invoke("stop_transcode").catch((err) => console.error("Transcoder stop failed:", err));
        setHlsSrc("");
      }
    } else if (!vlcActive) {
      currentPlayingFileRef.current = null;
      invoke("stop_transcode").catch((err) => console.error("Transcoder stop failed:", err));
      setHlsSrc("");
    }
  }, [playoutState?.active_entry?.file_path, vlcActive, isWebCompatible]);

  // Native WebKit HLS Playout Effect
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!hlsSrc || isWebCompatible) return;
    const targetVideo = hlsVideoRef.current;
    if (!targetVideo) return;
    if (targetVideo.readyState >= 2) {
      targetVideo.play().catch(err => console.warn("Native HLS play call error:", err));
    }
  }, [hlsSrc, isWebCompatible]);

  // Seek and autoplay natively supported files
  useEffect(() => {
    if (vlcActive && activeEntry && isWebCompatible && videoRef.current) {
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
      const currentVideoTime = videoRef.current.currentTime;
      if (Math.abs(currentVideoTime - targetSec) > 1.5) {
        videoRef.current.currentTime = targetSec;
      }
      videoRef.current.play().catch((err) => console.warn("Direct playout play call error:", err));
    }
  }, [playoutState?.active_entry?.id, vlcActive, isWebCompatible]);

  const formatRuntime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
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
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "grid" }))}
                className="ml-2 text-[10px] font-bold text-accent bg-accent/15 border border-accent/30 hover:bg-accent hover:text-black transition-all px-2.5 py-0.5 rounded tracking-wider cursor-pointer font-mono"
              >
                GO TO SCHEDULER
              </button>
            </div>
            <div className="flex items-center space-x-2 bg-gray-900 border border-gray-800 px-3 py-1 rounded">
              <Clock size={14} className="text-accent" />
              <span className="text-xs text-accent font-bold">{timeStr}</span>
            </div>
          </div>

          {/* Timeline Stack */}
          <div className="space-y-3 h-[calc(100vh-280px)] overflow-y-auto pr-2">
            {comingPrograms.length > 0 ? (
              comingPrograms.map((program) => {
                const isActive = activeEntry && program.id === activeEntry.id;
                return (
                  <div 
                    key={program.id}
                    className={`p-4 rounded-lg relative transition-all duration-200 border ${
                      isActive 
                        ? "bg-onair/5 border-onair/30 hover:border-onair" 
                        : "bg-panel border-gray-800 hover:border-accent/40"
                    }`}
                    onMouseEnter={() => setHoveredItem(program)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-3 text-[9px] font-bold text-onair bg-onair/20 px-1.5 py-0.5 rounded tracking-widest animate-pulse">
                        ON AIR NOW
                      </div>
                    )}
                    <div className="text-xs text-gray-500 font-bold mb-1">
                      {new Date(program.start_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })} - {new Date(program.end_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                    <div className={`text-sm font-bold ${isActive ? "text-gray-100" : "text-gray-300"}`}>{program.item_title}</div>
                    <div className={`text-[10px] mt-1 flex space-x-3 ${isActive ? "text-gray-400" : "text-gray-500"}`}>
                      <span>TYPE: {program.media_type.toUpperCase()}</span>
                      <span>DURATION: {formatRuntime(program.duration)}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 bg-gray-950 border border-dashed border-gray-800 rounded-lg text-center text-gray-500 text-xs flex flex-col items-center justify-center space-y-2">
                <AlertTriangle className="text-onair" size={20} />
                <span>NO LIVE CONTENT SCHEDULED FOR THE REST OF TODAY</span>
              </div>
            )}
          </div>
        </div>

        {/* Hover detail panel */}
        <div className="bg-panel border border-gray-800 rounded-lg p-4 h-40 flex items-center space-x-4 relative">
          <div className="absolute top-2 right-4 text-[9px] text-gray-600">INSPECT BLOCK</div>
          {hoveredItem ? (
            <div className="flex items-center space-x-4 w-full">
              <img 
                src={(hoveredItem.duration !== 0 && hoveredItem.poster_path) ? getPosterUrl(hoveredItem.poster_path) : getFallbackPosterUrl(hoveredItem.media_item_id)} 
                alt="Poster" 
                className="w-20 h-28 object-cover rounded border border-gray-800 shadow"
              />
              <div className="space-y-2 flex-1">
                <div className="text-xs font-bold text-accent">{hoveredItem.item_title}</div>
                <div className="text-[10px] text-gray-400 space-y-1">
                  <div>DURATION: {formatRuntime(hoveredItem.duration)}</div>
                  <div>START: {new Date(hoveredItem.start_time).toLocaleString()}</div>
                  <div>END: {new Date(hoveredItem.end_time).toLocaleString()}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center w-full text-gray-600 text-xs">
              Hover over a timeline item to inspect details.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: LIVE PLAYOUT FEED MONITOR */}
      <div className="w-1/2 flex flex-col justify-between p-6 space-y-6">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-bold tracking-widest text-accent">ON AIR MONITOR</span>
            <button
              onClick={() => invoke("open_tv_window").catch(err => console.error(err))}
              className="text-[10px] font-bold text-onair bg-onair/15 border border-onair/30 hover:bg-onair hover:text-black transition-all px-2.5 py-0.5 rounded tracking-wider cursor-pointer font-mono"
            >
              GO TO TV
            </button>
            <button
              onClick={() => {
                if (activeEntry?.file_path) {
                  invoke("open_in_vlc_app", { filePath: activeEntry.file_path }).catch(err => console.error(err));
                }
              }}
              className="text-[10px] font-bold text-cyan-400 bg-cyan-400/15 border border-cyan-400/30 hover:bg-cyan-400 hover:text-black transition-all px-2.5 py-0.5 rounded tracking-wider cursor-pointer font-mono flex items-center space-x-1"
              title="Launch video natively in VLC Player app"
            >
              <PlayCircle size={11} />
              <span>LAUNCH NATIVE VLC PLAYER</span>
            </button>
          </div>
          <div className="flex items-center space-x-1 text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded text-[10px] border border-emerald-500/20">
            <Eye size={12} />
            <span>STATISTICS: STABLE</span>
          </div>
        </div>

        {/* Professional Video Playout Box */}
        <div className="aspect-video w-full bg-black rounded-lg border border-gray-800 relative overflow-hidden flex items-center justify-center group shadow-2xl">
          {activeEntry?.file_path ? (
            vlcActive ? (
              isWebCompatible ? (
                // Direct playout of audio-only files
                <div className="w-full h-full relative">
                  <video
                    ref={videoRef}
                    src={convertFileSrc(activeEntry.file_path)}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    onError={() => {
                      console.warn("Native WebKit video playout failed for file. Automatic failover to VLC HLS proxy stream...");
                      setForceVlcMode(true);
                    }}
                  >
                    {vttTrackUrl && (
                      <track src={vttTrackUrl} kind="subtitles" srcLang="en" label="Subtitles" default />
                    )}
                  </video>
                  <div className="absolute top-2 left-2 flex items-center space-x-1.5 text-[9px] bg-blue-600/90 px-2 py-0.5 rounded text-white tracking-wider font-extrabold shadow border border-blue-500/20 z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    <span>NATIVE DIRECT PLAYOUT</span>
                  </div>

                  {/* Audio & Subtitle Control Bar */}
                  <div className="absolute top-2 right-10 flex items-center space-x-2 z-20">
                    {/* Audio Track Selector */}
                    <div className="relative">
                      <button
                        onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }}
                        className="flex items-center space-x-1 px-2 py-1 bg-black/80 hover:bg-black text-xs text-gray-200 border border-gray-700 hover:border-accent rounded transition-all"
                        title="Audio Language Selection"
                      >
                        <Globe size={13} className="text-accent" />
                        <span className="text-[10px] font-bold">{selectedAudioTrack}</span>
                        <ChevronDown size={11} />
                      </button>

                      {showAudioMenu && (
                        <div className="absolute top-full right-0 mt-1 w-44 bg-gray-900 border border-gray-700 rounded-md shadow-2xl z-30 py-1 font-sans text-xs">
                          <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase">Audio Track</div>
                          {availableAudioTracks.map((trk) => (
                            <button
                              key={trk}
                              onClick={() => handleAudioTrackSelect(trk)}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                                selectedAudioTrack === trk ? "text-accent font-bold" : "text-gray-300"
                              }`}
                            >
                              <span>{trk}</span>
                              {selectedAudioTrack === trk && <Check size={12} className="text-accent" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Subtitles Track Selector */}
                    <div className="relative">
                      <button
                        onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }}
                        className="flex items-center space-x-1 px-2 py-1 bg-black/80 hover:bg-black text-xs text-gray-200 border border-gray-700 hover:border-accent rounded transition-all"
                        title="Subtitle Track Selection"
                      >
                        <Subtitles size={13} className="text-accent" />
                        <span className="text-[10px] font-bold">
                          {selectedSubtitleId === "off"
                            ? "Subtitles: Off"
                            : subtitles.find(s => s.id === selectedSubtitleId)?.language.toUpperCase() || "Subtitles"}
                        </span>
                        <ChevronDown size={11} />
                      </button>

                      {showSubMenu && (
                        <div className="absolute top-full right-0 mt-1 w-48 bg-gray-900 border border-gray-700 rounded-md shadow-2xl z-30 py-1 font-sans text-xs">
                          <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase">Subtitles</div>
                          <button
                            onClick={() => { setSelectedSubtitleId("off"); setShowSubMenu(false); }}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                              selectedSubtitleId === "off" ? "text-accent font-bold" : "text-gray-300"
                            }`}
                          >
                            <span>Off</span>
                            {selectedSubtitleId === "off" && <Check size={12} className="text-accent" />}
                          </button>

                          {subtitles.map((sub) => (
                            <button
                              key={sub.id}
                              onClick={() => { setSelectedSubtitleId(sub.id); setShowSubMenu(false); }}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                                selectedSubtitleId === sub.id ? "text-accent font-bold" : "text-gray-300"
                              }`}
                            >
                              <span>{sub.language.toUpperCase()} ({sub.subtitle_type.toUpperCase()})</span>
                              {selectedSubtitleId === sub.id && <Check size={12} className="text-accent" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setVlcActive(false)}
                    className="absolute top-2 right-2 p-1 bg-black/80 hover:bg-black text-red-500 border border-red-500/20 rounded hover:border-red-500 transition-colors z-10"
                    title="Stop Playout Feed"
                  >
                    <StopCircle size={14} />
                  </button>

                  {/* SUBTITLE OVERLAY */}
                  {activeCueText && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/90 text-yellow-300 font-sans font-bold text-sm px-4 py-1.5 rounded border border-yellow-500/30 shadow-2xl backdrop-blur-md pointer-events-none z-20 max-w-[85%] text-center leading-relaxed">
                      {activeCueText}
                    </div>
                  )}

                  {/* BACK TO LIVE RESYNC OVERLAY */}
                  {showBackToLive && (
                    <button
                      onClick={() => {
                        if (videoRef.current && playoutState?.playout_position_ms) {
                          videoRef.current.currentTime = playoutState.playout_position_ms / 1000;
                          videoRef.current.play().catch(err => console.warn(err));
                          setShowBackToLive(false);
                        }
                      }}
                      className="absolute bottom-16 right-4 flex items-center space-x-1.5 bg-accent hover:bg-accent/90 text-black px-3 py-1.5 rounded-full text-[10px] font-bold shadow-lg transition-all animate-bounce cursor-pointer z-10"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                      <span>BACK TO LIVE</span>
                    </button>
                  )}
                </div>
              ) : (
                // Transcoded HLS stream via VLC dummy background service
                <div className="w-full h-full relative bg-zinc-950">
                  {hlsSrc ? (
                    <video
                      ref={hlsVideoRef}
                      src={hlsSrc}
                      className="w-full h-full object-contain"
                      controls
                      autoPlay
                      playsInline
                      crossOrigin="anonymous"
                      onCanPlay={(e) => {
                        (e.target as HTMLVideoElement).play().catch((err) => console.warn("HLS play onCanPlay error:", err));
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-black/90 space-y-3 p-6 text-center">
                      <RefreshCw size={24} className="text-emerald-400 animate-spin" />
                      <div className="text-emerald-400 text-xs font-bold tracking-widest uppercase">
                        INITIALIZING UNIVERSAL VLC LIVE BROADCAST...
                      </div>
                      <div className="text-[10px] text-gray-500 max-w-xs leading-relaxed font-mono">
                        Hardware decoding and HLS proxy stream generating in background...
                      </div>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center space-x-1.5 text-[9px] bg-emerald-600/90 px-2 py-0.5 rounded text-white tracking-wider font-extrabold shadow border border-emerald-500/20 z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>VLC BACKEND STREAMING</span>
                  </div>

                  {/* Audio & Subtitle Control Bar for VLC Mode */}
                  <div className="absolute top-2 right-28 flex items-center space-x-2 z-20">
                    {/* Subtitles Track Selector */}
                    <div className="relative">
                      <button
                        onClick={() => setShowSubMenu(!showSubMenu)}
                        className="flex items-center space-x-1 px-2 py-1 bg-black/80 hover:bg-black text-xs text-gray-200 border border-gray-700 hover:border-accent rounded transition-all"
                        title="Subtitle Track Selection"
                      >
                        <Subtitles size={13} className="text-accent" />
                        <span className="text-[10px] font-bold">
                          {selectedSubtitleId === "off"
                            ? "Subtitles: Off"
                            : subtitles.find(s => s.id === selectedSubtitleId)?.language.toUpperCase() || "Subtitles"}
                        </span>
                        <ChevronDown size={11} />
                      </button>

                      {showSubMenu && (
                        <div className="absolute top-full right-0 mt-1 w-48 bg-gray-900 border border-gray-700 rounded-md shadow-2xl z-30 py-1 font-sans text-xs">
                          <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase">Subtitles</div>
                          <button
                            onClick={() => { setSelectedSubtitleId("off"); setShowSubMenu(false); }}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                              selectedSubtitleId === "off" ? "text-accent font-bold" : "text-gray-300"
                            }`}
                          >
                            <span>Off</span>
                            {selectedSubtitleId === "off" && <Check size={12} className="text-accent" />}
                          </button>

                          {subtitles.map((sub) => (
                            <button
                              key={sub.id}
                              onClick={() => { setSelectedSubtitleId(sub.id); setShowSubMenu(false); }}
                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                                selectedSubtitleId === sub.id ? "text-accent font-bold" : "text-gray-300"
                              }`}
                            >
                              <span>{sub.language.toUpperCase()} ({sub.subtitle_type.toUpperCase()})</span>
                              {selectedSubtitleId === sub.id && <Check size={12} className="text-accent" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Control Overlay to stop/relaunch VLC */}
                  <div className="absolute top-2 right-2 flex items-center space-x-2 z-10">
                    <button
                      onClick={() => {
                        const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
                        setHlsSrc(""); // Reset to force reload
                        invoke<string>("start_transcode", {
                          filePath: activeEntry.file_path,
                          startTimeSec: targetSec
                        })
                        .then(() => {
                          setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}`);
                        })
                        .catch((err) => console.error("VLC relaunch failed:", err));
                      }}
                      className="flex items-center space-x-1.5 p-1 px-2.5 bg-black/80 hover:bg-black text-accent border border-accent/20 rounded hover:border-accent transition-colors text-[9px] font-bold"
                      title="Sync / Relaunch Stream to active time"
                    >
                      <RefreshCw size={11} />
                      <span>BACK TO LIVE</span>
                    </button>
                    <button
                      onClick={() => setVlcActive(false)}
                      className="p-1 bg-black/80 hover:bg-black text-red-500 border border-red-500/20 rounded hover:border-red-500 transition-colors"
                      title="Stop Playout Feed"
                    >
                      <StopCircle size={14} />
                    </button>
                  </div>

                  {/* SUBTITLE OVERLAY */}
                  {activeCueText && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/90 text-yellow-300 font-sans font-bold text-sm px-4 py-1.5 rounded border border-yellow-500/30 shadow-2xl backdrop-blur-md pointer-events-none z-20 max-w-[85%] text-center leading-relaxed">
                      {activeCueText}
                    </div>
                  )}
                </div>
              )
            ) : (
              // STANDBY INTERFACE: CLICK TO START PLAYOUT
              <div 
                onClick={() => setVlcActive(true)}
                className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center cursor-pointer space-y-4 hover:bg-zinc-900 transition-all duration-300 border border-gray-800 rounded-lg group p-8 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-accent/5 border border-accent/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-accent/10 group-hover:border-accent/40 transition-all duration-300 shadow-inner">
                  <PlayCircle size={32} className="text-accent fill-accent/10 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="text-accent text-xs font-bold tracking-widest uppercase">
                    START MONITOR PLAYOUT FEED
                  </div>
                  <div className="text-[10px] text-gray-400 max-w-sm leading-relaxed">
                    Click to launch integrated playout monitor feed, fully synchronized to the active EPG schedule timeline.
                  </div>
                </div>
                <div className="text-[9px] text-gray-600 font-mono italic">
                  Utilizes native hardware decoding or headless VLC background transcoding automatically.
                </div>
              </div>
            )
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
                <div className="text-onair font-bold tracking-widest text-sm animate-pulse">NO LIVE PLAYOUT</div>
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
        </div>

        {/* Current Active details stats */}
        <div className="bg-panel border border-gray-800 rounded-lg p-5 space-y-3 relative">
          <div className="absolute top-2 right-4 text-[9px] text-gray-600">LIVE FEED TELEMETRY</div>
          {activeEntry ? (
            <div className="space-y-2">
              <div className="text-sm font-bold text-accent">{activeEntry.item_title}</div>
              <div className="grid grid-cols-2 gap-y-2 text-[10px] text-gray-400">
                <div>VIDEO CODEC: <span className="text-gray-200 font-bold">{activeEntry.file_path ? (activeEntry.file_path.split('.').pop() || 'h264').toUpperCase() : "NONE"}</span></div>
                <div>AUDIO TRACK: <span className="text-gray-200 font-bold">{selectedAudioTrack}</span></div>
                <div>SUBTITLES: <span className="text-gray-200 font-bold">{selectedSubtitleId === "off" ? "OFF" : (subtitles.find(s => s.id === selectedSubtitleId)?.language.toUpperCase() || "ACTIVE")}</span></div>
                <div>PLAYBACK POSITION: <span className="text-gray-200 font-bold">{Math.round(localProgress)}s / {activeEntry.duration}s ({remainingTimeStr} rem)</span></div>
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
