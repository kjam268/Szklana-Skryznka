import React, { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useChannelStore, SubtitleRecordInfo, AudioStreamInfo } from "../store";
import { Globe, Subtitles, ChevronDown, Check, RefreshCw } from "lucide-react";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface HlsStatus {
  is_streaming: boolean;
  current_file: string | null;
  hls_url: string;
  playout_start_sec: number;
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


export const TvClient: React.FC = () => {
  const { playoutState, fetchPlayoutState, channels, fetchChannels, activeChannelId } = useChannelStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsSrc, setHlsSrc] = useState<string>("");
  const hlsSrcRef = useRef<string>("");
  useEffect(() => { hlsSrcRef.current = hlsSrc; }, [hlsSrc]);
  // Track which file is currently playing to avoid redundant src resets
  const hlsFileRef = useRef<string | null>(null);
  // Store the playout_start_sec from ffmpeg so we can sync position on connect
  const hlsPlayoutStartRef = useRef<number>(0);

  // Subtitles & Audio Track state
  const [subtitles, setSubtitles] = useState<SubtitleRecordInfo[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("off");
  const [currentCues, setCurrentCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string>("");
  const [vttTrackUrl, setVttTrackUrl] = useState<string>("");
  const [showControls, setShowControls] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);

  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioStreamInfo[]>([]);
  const [selectedAudioTrackIdx, setSelectedAudioTrackIdx] = useState<number>(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Sync EPG State periodically
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    const channelId = channels[0]?.id || "chan_default";
    fetchPlayoutState(channelId, new Date().toISOString());

    const slowInterval = setInterval(() => {
      fetchPlayoutState(channelId, new Date().toISOString());
    }, 6000);

    return () => clearInterval(slowInterval);
  }, [channels, fetchPlayoutState]);

  const activeEntry = playoutState?.active_entry;
  const isAudioOnly = activeEntry?.file_path
    ? (activeEntry.file_path.toLowerCase().endsWith(".mp3") ||
       activeEntry.file_path.toLowerCase().endsWith(".aac") ||
       activeEntry.file_path.toLowerCase().endsWith(".wav") ||
       activeEntry.file_path.toLowerCase().endsWith(".flac"))
    : false;

  // ── Play Count: 60-second confirmed-viewing threshold (mirrors OnAir.tsx) ───
  const tvPlayCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tvLastRecordedEntryRef = useRef<string | null>(null);

  useEffect(() => {
    if (tvPlayCountTimerRef.current) {
      clearTimeout(tvPlayCountTimerRef.current);
      tvPlayCountTimerRef.current = null;
    }

    const entryId = activeEntry?.media_item_id;
    if (!entryId) return;
    // Avoid double-counting the same session
    if (tvLastRecordedEntryRef.current === entryId) return;

    const entryStartMs = activeEntry?.start_time
      ? new Date(activeEntry.start_time).getTime()
      : Date.now();

    tvPlayCountTimerRef.current = setTimeout(() => {
      const elapsed = Math.round((Date.now() - entryStartMs) / 1000);
      invoke("record_movie_played", {
        mediaItemId: entryId,
        channelId: activeChannelId || channels[0]?.id || "chan_default",
        durationAired: Math.max(elapsed, 60),
      }).catch(err => console.warn("TV: Failed to record play count:", err));
      tvLastRecordedEntryRef.current = entryId;
    }, 60_000);

    return () => {
      if (tvPlayCountTimerRef.current) {
        clearTimeout(tvPlayCountTimerRef.current);
        tvPlayCountTimerRef.current = null;
      }
    };
  }, [activeEntry?.media_item_id, activeChannelId, channels]);
  // ──────────────────────────────────────────────────────

  const isWebCompatible = isAudioOnly;

  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };

  const getFallbackPosterUrl = (_itemId: string) => "/no_poster42.png";

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Helper: build human-readable label for an audio stream
  const buildAudioLabel = (track: AudioStreamInfo): string => {
    const lang = track.language && track.language !== "und" ? track.language.toUpperCase() : "UND";
    const layout = track.channel_layout || (track.channels >= 6 ? "5.1" : "Stereo");
    const codec = track.codec_name.toUpperCase();
    const title = track.title ? ` — ${track.title}` : "";
    const defTag = track.is_default ? " ✓" : "";
    return `${lang} — ${layout} (${codec}${title})${defTag}`;
  };

  // Fetch subtitles (universal: external + embedded) and audio tracks
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

    invoke<SubtitleRecordInfo[]>("get_media_subtitles", {
      mediaItemId: activeEntry.media_item_id,
      filePath: activeEntry.file_path || null,
    })
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
        console.error("Failed to fetch subtitles in TV client:", err);
        setSubtitles([]);
      });

    // Probe real audio streams
    if (activeEntry.file_path) {
      invoke<{ audio: AudioStreamInfo[] }>("list_media_streams", { path: activeEntry.file_path })
        .then((streams) => {
          const audioTracks = streams.audio || [];
          setAvailableAudioTracks(audioTracks);
          const defaultIdx = audioTracks.findIndex(t => t.is_default);
          setSelectedAudioTrackIdx(defaultIdx >= 0 ? defaultIdx : 0);
        })
        .catch(() => {
          const fallback: AudioStreamInfo[] = [{
            index: 0, codec_name: "aac", codec_long_name: "AAC",
            sample_rate: 48000, channels: 2, channel_layout: "Stereo",
            language: activeEntry.audio_language || "und", bitrate: 0,
            title: undefined, is_default: true
          }];
          setAvailableAudioTracks(fallback);
          setSelectedAudioTrackIdx(0);
        });
    } else {
      setAvailableAudioTracks([]);
      setSelectedAudioTrackIdx(0);
    }
  }, [activeEntry?.media_item_id]);

  // Load and parse selected subtitle track via Tauri IPC
  useEffect(() => {
    if (selectedSubtitleId === "off" || !selectedSubtitleId) {
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      return;
    }

    const sub = subtitles.find(s => s.id === selectedSubtitleId);
    if (!sub) {
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      return;
    }

    const trackIndex = (sub as SubtitleRecordInfo).track_index;
    invoke<string>("read_subtitle_content", {
      filePath: sub.file_path || activeEntry?.file_path || null,
      subtitleId: sub.id,
      trackIndex: trackIndex !== undefined ? trackIndex : null,
    })
      .then(text => {
        const cues = parseSrtToCues(text);
        setCurrentCues(cues);
        const vttText = "WEBVTT\n\n" + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
        const blob = new Blob([vttText], { type: "text/vtt" });
        setVttTrackUrl(URL.createObjectURL(blob));
      })
      .catch(err => {
        console.error("Failed to load subtitle content in TV Client:", err);
        setCurrentCues([]);
        setVttTrackUrl("");
      });
  }, [selectedSubtitleId, subtitles, activeEntry?.file_path]);

  // Update active subtitle cue text on playback tick with high frequency
  useEffect(() => {
    if (currentCues.length === 0) {
      setActiveCueText("");
      return;
    }

    const updateCue = () => {
      let currentSec = 0;
      if (videoRef.current && !videoRef.current.paused) {
        currentSec = videoRef.current.currentTime;
      } else if (tvHlsVideoRef.current && !tvHlsVideoRef.current.paused) {
        currentSec = hlsPlayoutStartRef.current + tvHlsVideoRef.current.currentTime;
      } else if (activeEntry?.start_time) {
        const startMs = new Date(activeEntry.start_time).getTime();
        const nowMs = Date.now();
        currentSec = Math.max(0, (nowMs - startMs) / 1000);
      } else if (playoutState?.playout_position_ms) {
        currentSec = playoutState.playout_position_ms / 1000;
      }

      const match = currentCues.find(c => currentSec >= c.start && currentSec <= c.end);
      setActiveCueText(match ? match.text : "");
    };

    const interval = setInterval(updateCue, 200);
    return () => clearInterval(interval);
  }, [currentCues, activeEntry?.start_time, playoutState?.playout_position_ms]);

  // Poll get_hls_status — pick up stream started by OnAir Monitor.
  // If no stream is running but we have an active EPG entry, auto-start the transcoder
  // so TvClient works independently without requiring OnAir to be open.
  const autoStartFileRef = useRef<string | null>(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await invoke<HlsStatus>("get_hls_status");
        if (status.is_streaming && status.current_file) {
          // Stream already running (by OnAir or a previous auto-start) — just attach
          if (status.current_file !== hlsFileRef.current) {
            hlsFileRef.current = status.current_file;
            hlsPlayoutStartRef.current = status.playout_start_sec;
            setHlsSrc(status.hls_url);
          }
        } else {
          // No stream running — auto-start if we have an active non-audio file
          const filePath = playoutState?.active_entry?.file_path;
          const posMs = playoutState?.playout_position_ms ?? 0;
          if (filePath && filePath !== autoStartFileRef.current && !isAudioOnly) {
            autoStartFileRef.current = filePath;
            hlsFileRef.current = null; // will be set after transcode starts
            try {
              await invoke<string>("start_transcode", {
                filePath,
                startTimeSec: posMs / 1000,
                audioTrackIndex: null,
              });
              // Fetch updated status to get the real hls_url
              const newStatus = await invoke<HlsStatus>("get_hls_status");
              hlsFileRef.current = newStatus.current_file;
              hlsPlayoutStartRef.current = newStatus.playout_start_sec;
              setHlsSrc(`${newStatus.hls_url}?t=${Date.now()}`);
            } catch (err) {
              console.error("TvClient auto-start transcode failed:", err);
              autoStartFileRef.current = null;
            }
          } else if (!filePath) {
            // Nothing scheduled — clear
            if (hlsFileRef.current !== null) {
              hlsFileRef.current = null;
              autoStartFileRef.current = null;
              setHlsSrc("");
            }
          }
        }
      } catch {
        // Silently ignore — stream may just be starting
      }
    };

    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [playoutState?.active_entry?.file_path, playoutState?.playout_position_ms, isAudioOnly]);

  // HLS playout effect: on src change, ensure video plays immediately
  const tvHlsVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!hlsSrc || isWebCompatible) return;
    const video = tvHlsVideoRef.current;
    if (!video) return;
    // The video element already has autoPlay, but we also call play() here in case
    // the browser deferred it. No seek needed — HLS live naturally seeks to the live edge,
    // which is the same content frame OnAir Monitor is showing.
    video.play().catch(err => console.warn("TV Client HLS play error:", err));
  }, [hlsSrc, isWebCompatible]);

  // Synchronize playout offset for direct playout files
  useEffect(() => {
    if (activeEntry && isWebCompatible && videoRef.current) {
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
      const currentVideoTime = videoRef.current.currentTime;
      if (Math.abs(currentVideoTime - targetSec) > 2.0) {
        videoRef.current.currentTime = targetSec;
      }
      videoRef.current.play().catch((err) => console.warn("TV client auto-play error:", err));
    }
  }, [activeEntry?.id, isWebCompatible, playoutState?.playout_position_ms]);

  const handleAudioTrackSelect = (track: AudioStreamInfo, newIdx: number) => {
    const prevIdx = selectedAudioTrackIdx;
    setSelectedAudioTrackIdx(newIdx);
    setShowAudioMenu(false);
    // For direct playout (audio-only), try HTMLMediaElement.audioTracks
    if (videoRef.current && (videoRef.current as any).audioTracks) {
      const at = (videoRef.current as any).audioTracks;
      for (let i = 0; i < at.length; i++) {
        at[i].enabled = (i === newIdx);
      }
    }
    // For HLS: restart transcoder with the new audio track index
    if (hlsSrc && activeEntry?.file_path && newIdx !== prevIdx) {
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
      setHlsSrc("");
      invoke<string>("start_transcode", {
        filePath: activeEntry.file_path,
        startTimeSec: targetSec,
        audioTrackIndex: track.index,
      })
        .then(() => setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}&a=${newIdx}`))
        .catch((err) => console.error("TV audio track switch failed:", err));
    }
  };

  return (
    <div 
      className="w-screen h-screen bg-black overflow-hidden flex items-center justify-center relative select-none group"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { setShowControls(false); setShowAudioMenu(false); setShowSubMenu(false); }}
      onMouseMove={() => setShowControls(true)}
    >
      {activeEntry?.file_path ? (
        <div className="w-full h-full relative flex items-center justify-center">
          {isWebCompatible ? (
            <video
              ref={videoRef}
              src={convertFileSrc(activeEntry.file_path)}
              className="w-full h-full object-contain"
              autoPlay
              muted={false}
              loop={false}
              onError={() => {
                console.warn("Direct video playout failed for file.");
              }}
            >
              {vttTrackUrl && (
                <track src={vttTrackUrl} kind="subtitles" srcLang="en" label="Subtitles" default />
              )}
            </video>
          ) : hlsSrc ? (
            <video
              ref={tvHlsVideoRef}
              src={hlsSrc}
              className="w-full h-full object-contain"
              autoPlay
              muted={false}
              loop={false}
              playsInline
              crossOrigin="anonymous"
              onCanPlay={(e) => {
                const v = e.target as HTMLVideoElement;
                // Seek to live edge: seekable.end(0) gives the most recently transcoded position.
                // This ensures TvClient is in sync with OnAir which is also at the live edge.
                if (v.seekable.length > 0) {
                  v.currentTime = v.seekable.end(0);
                }
                v.play().catch(err => console.warn("TV Client HLS canplay error:", err));
              }}
              onError={(e) => {
                console.warn("TV Client HLS video error:", (e.target as HTMLVideoElement).error);
              }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black space-y-4 p-8 text-center">
              <RefreshCw size={36} className="text-onair animate-spin" />
              <div className="text-onair text-sm font-bold tracking-widest uppercase font-mono">
                CONNECTING TO UNIVERSAL LIVE TV BROADCAST...
              </div>
              <div className="text-xs text-gray-500 max-w-sm leading-relaxed font-mono">
                Launching background stream encoder and syncing live position...
              </div>
            </div>
          )}

          {/* ON-SCREEN SUBTITLE OVERLAY (Adjusts height dynamically when info overlay is hovered) */}
          {activeCueText && (
            <div className={`absolute left-1/2 -translate-x-1/2 bg-black/90 text-yellow-300 font-sans font-extrabold text-lg px-6 py-2 rounded-lg border border-yellow-500/40 shadow-2xl backdrop-blur-md pointer-events-none z-30 max-w-[85%] text-center leading-relaxed transition-all duration-300 ${
              showControls && activeEntry ? "bottom-44" : "bottom-12"
            }`}>
              {activeCueText}
            </div>
          )}

          {/* TV CLIENT CONTROLS OVERLAY (Shown on mouse hover) */}
          <div className={`absolute top-4 right-4 flex items-center space-x-3 transition-opacity duration-300 z-30 font-mono ${showControls || showAudioMenu || showSubMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            {/* Pause / Resume (local only — does not affect other streams) */}
            <button
              onClick={() => {
                const vid = isWebCompatible ? videoRef.current : tvHlsVideoRef.current;
                if (!vid) return;
                if (isPaused) { vid.play().catch(() => {}); setIsPaused(false); }
                else          { vid.pause(); setIsPaused(true); }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/80 hover:bg-black text-xs text-white border border-gray-700 hover:border-cyan-400 rounded-lg shadow-xl backdrop-blur-md transition-all"
              title={isPaused ? "Resume" : "Pause (local only)"}
            >
              <span className="text-sm">{isPaused ? "▶" : "⏸"}</span>
              <span className="font-bold">{isPaused ? "RESUME" : "PAUSE"}</span>
            </button>
            <div className="relative">
              <button
                onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/80 hover:bg-black text-xs text-white border border-gray-700 hover:border-cyan-400 rounded-lg shadow-xl backdrop-blur-md transition-all"
                title="Audio Language Selection"
              >
                <Globe size={14} className="text-cyan-400" />
                <span className="text-xs font-bold max-w-[120px] truncate">
                  {availableAudioTracks[selectedAudioTrackIdx]
                    ? buildAudioLabel(availableAudioTracks[selectedAudioTrackIdx])
                    : "Audio"}
                </span>
                <ChevronDown size={12} />
              </button>

              {showAudioMenu && (
                <div className="absolute top-full right-0 mt-1 w-60 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1 font-sans text-xs">
                  <div className="px-3 py-1 text-[10px] font-bold text-gray-400 border-b border-gray-800 uppercase">Audio Track</div>
                  {availableAudioTracks.map((trk, i) => (
                    <button
                      key={trk.index}
                      onClick={() => handleAudioTrackSelect(trk, i)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                        selectedAudioTrackIdx === i ? "text-cyan-400 font-bold" : "text-gray-200"
                      }`}
                    >
                      <span className="truncate">{buildAudioLabel(trk)}</span>
                      {selectedAudioTrackIdx === i && <Check size={14} className="text-cyan-400 shrink-0 ml-1" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles Selector */}
            <div className="relative">
              <button
                onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/80 hover:bg-black text-xs text-white border border-gray-700 hover:border-cyan-400 rounded-lg shadow-xl backdrop-blur-md transition-all"
                title="Subtitle Track Selection"
              >
                <Subtitles size={14} className="text-cyan-400" />
                <span className="text-xs font-bold max-w-[120px] truncate">
                  {selectedSubtitleId === "off"
                    ? "Subtitles: Off"
                    : subtitles.find(s => s.id === selectedSubtitleId)?.label || "Subtitles"}
                </span>
                <ChevronDown size={12} />
              </button>

              {showSubMenu && (
                <div className="absolute top-full right-0 mt-1 w-52 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1 font-sans text-xs">
                  <div className="px-3 py-1 text-[10px] font-bold text-gray-400 border-b border-gray-800 uppercase">Subtitles</div>
                  <button
                    onClick={() => { setSelectedSubtitleId("off"); setShowSubMenu(false); }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                      selectedSubtitleId === "off" ? "text-cyan-400 font-bold" : "text-gray-200"
                    }`}
                  >
                    <span>Off</span>
                    {selectedSubtitleId === "off" && <Check size={14} className="text-cyan-400" />}
                  </button>

                  {subtitles.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => { setSelectedSubtitleId(sub.id); setShowSubMenu(false); }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                        selectedSubtitleId === sub.id ? "text-cyan-400 font-bold" : "text-gray-200"
                      }`}
                    >
                      <span className="truncate">{sub.label}</span>
                      {selectedSubtitleId === sub.id && <Check size={14} className="text-cyan-400 shrink-0 ml-1" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CINEMATIC HOVER INFO OVERLAY (bottom-left, shown on mouse hover) */}
          {activeEntry && (
            <div
              className={`absolute bottom-0 left-0 right-0 z-20 pointer-events-none transition-all duration-500 ${
                showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              {/* Gradient fade from black at bottom */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />
              <div className="relative z-10 flex items-end gap-5 px-8 pb-8 pt-24">
                {/* Poster thumbnail with convertFileSrc and fallback */}
                <div className="w-20 h-28 rounded-lg overflow-hidden shadow-2xl border border-white/10 shrink-0 hidden sm:flex items-center justify-center bg-zinc-950">
                  <img
                    src={activeEntry.poster_path ? getPosterUrl(activeEntry.poster_path) : getFallbackPosterUrl(activeEntry.media_item_id || activeEntry.id)}
                    alt={activeEntry.item_title}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = getFallbackPosterUrl(activeEntry.media_item_id || activeEntry.id);
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* Title + year */}
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <h2 className="text-white font-extrabold text-2xl leading-tight tracking-tight drop-shadow-lg">
                      {activeEntry.item_title}
                    </h2>
                    {activeEntry.year && (
                      <span className="text-gray-400 text-sm font-mono shrink-0">{activeEntry.year}</span>
                    )}
                  </div>
                  {/* Director */}
                  {activeEntry.director && (
                    <div className="text-cyan-400 text-xs font-semibold tracking-wide">
                      Dir. {activeEntry.director}
                    </div>
                  )}
                  {/* Synopsis */}
                  {activeEntry.synopsis && activeEntry.synopsis !== "Scanned local content" && (
                    <p className="text-gray-300 text-xs leading-relaxed line-clamp-3 max-w-2xl">
                      {activeEntry.synopsis}
                    </p>
                  )}
                  {/* Badges row */}
                  <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                    <span className="text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {activeEntry.media_type}
                    </span>
                    {activeEntry.duration > 0 && (
                      <span className="text-[9px] font-mono text-gray-500">
                        {formatDuration(activeEntry.duration)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : hlsSrc ? (
        // HLS stream is running but no active_entry yet (EPG polling lag) — show the stream
        <div className="w-full h-full relative">
          <video
            ref={tvHlsVideoRef}
            src={hlsSrc}
            className="w-full h-full object-contain"
            autoPlay
            muted={false}
            loop={false}
            playsInline
            crossOrigin="anonymous"
            onCanPlay={(e) => {
              const v = e.target as HTMLVideoElement;
              if (v.seekable.length > 0) v.currentTime = v.seekable.end(0);
              v.play().catch(err => console.warn("TV Client HLS fallback canplay error:", err));
            }}
          />
        </div>
      ) : (
        // Station Standby - Color Bars
        <div className="w-full h-full relative flex flex-col justify-between overflow-hidden pointer-events-none">
          <div className="absolute inset-0 flex flex-col opacity-80">
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
          <div className="z-10 bg-black/90 px-6 py-4 border border-gray-800 rounded shadow-2xl m-auto text-center font-mono">
            <div className="text-rose-500 font-bold tracking-widest text-sm animate-pulse uppercase">NO ACTIVE STATION PLAYOUT</div>
            <div className="text-[10px] text-gray-500 mt-1 uppercase">STATION STANDBY PATTERN</div>
          </div>
        </div>
      )}
    </div>
  );
};
