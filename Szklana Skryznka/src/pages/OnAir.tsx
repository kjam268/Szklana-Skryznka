import React, { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useChannelStore, ScheduleEntryDetails, SubtitleRecordInfo, AudioStreamInfo } from "../store";
import { 
  Clock, Eye, AlertTriangle, StopCircle, RefreshCw, Globe, Subtitles, 
  ChevronDown, Check, Tv, Calendar, Play, Volume2, VolumeX, Maximize2, Sparkles,
  Radio, Plus, Trash2, Copy, ExternalLink
} from "lucide-react";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";


interface SubtitleCue {
  start: number;
  end: number;
  text: string;
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
  const { playoutState, fetchPlayoutState, channels, fetchChannels, activeChannelId, setActiveChannelId, createChannel, deleteChannel } = useChannelStore();
  const [monitorActive, setMonitorActive] = useState(true);
  const [playerUrl, setPlayerUrl] = useState("http://127.0.0.1:8098/player");
  const [urlCopied, setUrlCopied] = useState(false);

  useEffect(() => {
    invoke<string>("get_player_url").then(url => setPlayerUrl(url)).catch(() => {});
  }, []);

  const handleCopyPlayerUrl = async () => {
    try {
      await navigator.clipboard.writeText(playerUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      // fallback — open in browser via tauri opener
    }
  };
  const [hlsSrc, setHlsSrc] = useState<string>("");
  const [directVideoFailed, setDirectVideoFailed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showPlayerOverlay, setShowPlayerOverlay] = useState(false);
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const [showNewChannelForm, setShowNewChannelForm] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelProfile, setNewChannelProfile] = useState("Mixed Family Channel");
  const [channelActionLoading, setChannelActionLoading] = useState(false);

  
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  const hlsPlayoutStartRef = useRef<number>(0); // playout_position_ms/1000 at the moment we started the transcode
  const monitorActiveRef = useRef<boolean>(true); // mirrors monitorActive for use in event handlers (avoids stale closures)
  const monitorContainerRef = useRef<HTMLDivElement>(null);

  const [hoveredItem, setHoveredItem] = useState<ScheduleEntryDetails | null>(null);
  const [selectedInspectorItem, setSelectedInspectorItem] = useState<ScheduleEntryDetails | null>(null);
  const [inspectorSubtitles, setInspectorSubtitles] = useState<SubtitleRecordInfo[]>([]);
  const [inspectorAudioTracks, setInspectorAudioTracks] = useState<AudioStreamInfo[]>([]);

  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString("en-US", { hour12: false }));
  const [localProgress, setLocalProgress] = useState(0);
  const [remainingTimeStr, setRemainingTimeStr] = useState("00:00:00");
  const [comingPrograms, setComingPrograms] = useState<ScheduleEntryDetails[]>([]);

  // Active Subtitles & Audio Track state
  const [subtitles, setSubtitles] = useState<SubtitleRecordInfo[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("off");
  const [currentCues, setCurrentCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string>("");
  const [vttTrackUrl, setVttTrackUrl] = useState<string>("");
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [subOffsetMs, setSubOffsetMs] = useState<number>(0);

  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioStreamInfo[]>([]);
  const [selectedAudioTrackIdx, setSelectedAudioTrackIdx] = useState<number>(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showTelemetrySubMenu, setShowTelemetrySubMenu] = useState(false);
  const [showTelemetryAudioMenu, setShowTelemetryAudioMenu] = useState(false);

  const activeEntry = playoutState?.active_entry;
  const nextEntry = playoutState?.next_entry;

  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };

  const getFallbackPosterUrl = (_itemId: string) => {
    return "/no_poster42.png";
  };

  // Check if file is natively playable without transcode on macOS WebKit
  const isWebCompatible = activeEntry?.file_path
    ? (activeEntry.file_path.toLowerCase().endsWith(".mp4") ||
       activeEntry.file_path.toLowerCase().endsWith(".m4v") ||
       activeEntry.file_path.toLowerCase().endsWith(".mov") ||
       activeEntry.file_path.toLowerCase().endsWith(".mp3") ||
       activeEntry.file_path.toLowerCase().endsWith(".aac") ||
       activeEntry.file_path.toLowerCase().endsWith(".wav") ||
       activeEntry.file_path.toLowerCase().endsWith(".m4a"))
    : false;

  const isAudioOnly = activeEntry?.file_path
    ? (activeEntry.file_path.toLowerCase().endsWith(".mp3") ||
       activeEntry.file_path.toLowerCase().endsWith(".aac") ||
       activeEntry.file_path.toLowerCase().endsWith(".wav") ||
       activeEntry.file_path.toLowerCase().endsWith(".flac") ||
       activeEntry.file_path.toLowerCase().endsWith(".m4a"))
    : false;

  // Load channels on mount
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // ── Play Count: 60-second confirmed-viewing threshold ─────────────────────
  // We track the entry ID that started playing and only increment after 60s
  // of the SAME entry remaining active. This prevents phantom counts from
  // EPG poll refreshes or quick tab switches.
  const playCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecordedEntryRef = useRef<string | null>(null);

  useEffect(() => {
    // Cancel any pending timer from the previous entry
    if (playCountTimerRef.current) {
      clearTimeout(playCountTimerRef.current);
      playCountTimerRef.current = null;
    }

    const entryId = activeEntry?.media_item_id;
    if (!entryId) return;
    // Don't re-record the same session
    if (lastRecordedEntryRef.current === entryId) return;

    // Capture how long into the entry we are so we can compute elapsed duration
    const entryStartMs = activeEntry?.start_time
      ? new Date(activeEntry.start_time).getTime()
      : Date.now();

    playCountTimerRef.current = setTimeout(() => {
      const elapsed = Math.round((Date.now() - entryStartMs) / 1000);
      invoke("record_movie_played", {
        mediaItemId: entryId,
        channelId: activeChannelId,
        durationAired: Math.max(elapsed, 60),
      }).catch(err => console.warn("Failed to record play count:", err));
      lastRecordedEntryRef.current = entryId;
    }, 60_000); // 60 second confirmed-viewing threshold

    return () => {
      if (playCountTimerRef.current) {
        clearTimeout(playCountTimerRef.current);
        playCountTimerRef.current = null;
      }
    };
  }, [activeEntry?.media_item_id, activeChannelId]);
  // ─────────────────────────────────────────────────────────────────────────


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

        const channelId = activeChannelId || channels[0]?.id || "chan_default";
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
  }, [channels, activeChannelId, playoutState?.active_entry?.id]);


  // Helper: build human-readable label for an audio stream
  const buildAudioLabel = (track: AudioStreamInfo): string => {
    const lang = track.language && track.language !== "und"
      ? track.language.toUpperCase()
      : "UND";
    const layout = track.channel_layout || (track.channels === 1 ? "Mono" : track.channels >= 6 ? "5.1" : "Stereo");
    const codec = track.codec_name.toUpperCase();
    const title = track.title ? ` — ${track.title}` : "";
    const defTag = track.is_default ? " ✓" : "";
    return `${lang} — ${layout} (${codec}${title})${defTag}`;
  };

  // Fetch universal subtitles (external + embedded) and probe real audio tracks
  useEffect(() => {
    if (!activeEntry?.media_item_id) {
      setSubtitles([]);
      setSelectedSubtitleId("off");
      setCurrentCues([]);
      setActiveCueText("");
      setVttTrackUrl("");
      setAvailableAudioTracks([]);
      setSelectedAudioTrackIdx(0);
      return;
    }

    // Fetch subtitles
    invoke<SubtitleRecordInfo[]>("get_media_subtitles", {
      mediaItemId: activeEntry.media_item_id,
      filePath: activeEntry.file_path || null,
    })
      .then((res) => {
        setSubtitles(res || []);
        const defaultSub = res?.find(s => s.is_default === 1) || res?.[0];
        setSelectedSubtitleId(defaultSub ? defaultSub.id : "off");
      })
      .catch((err) => {
        console.error("Failed to fetch subtitles:", err);
        setSubtitles([]);
      });

    // Probe real audio streams from the media file
    if (activeEntry.file_path) {
      invoke<{ audio: AudioStreamInfo[] }>("list_media_streams", { path: activeEntry.file_path })
        .then((streams) => {
          const audioTracks = streams.audio || [];
          setAvailableAudioTracks(audioTracks);
          // Pre-select the default track, or the first one
          const defaultIdx = audioTracks.findIndex(t => t.is_default);
          setSelectedAudioTrackIdx(defaultIdx >= 0 ? defaultIdx : 0);
        })
        .catch(() => {
          // Fallback to CSV metadata if probing fails
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
  }, [activeEntry?.media_item_id, activeEntry?.file_path]);

  // Load and parse selected subtitle content via Tauri command
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

    invoke<string>("read_subtitle_content", {
      filePath: sub.file_path || activeEntry?.file_path || null,
      subtitleId: sub.id,
      trackIndex: sub.track_index !== undefined ? sub.track_index : null,
    })
      .then(text => {
        const cues = parseSrtToCues(text);
        setCurrentCues(cues);
        const vttUrl = srtToVttBlobUrl(text);
        setVttTrackUrl(vttUrl);
      })
      .catch(err => {
        console.warn("Failed to load subtitle content:", err);
        setCurrentCues([]);
        setVttTrackUrl("");
      });
  }, [selectedSubtitleId, subtitles, activeEntry?.file_path]);

  // Update active subtitle cue text on playback tick
  // Uses hlsVideoRef.currentTime + hlsPlayoutStartRef for HLS (file-relative position),
  // or videoRef.currentTime for direct playout, so cues always match SRT timestamps.
  useEffect(() => {
    if (currentCues.length === 0) {
      setActiveCueText("");
      return;
    }

    const updateCue = () => {
      let currentSec: number;
      if (hlsVideoRef.current && !hlsVideoRef.current.paused && hlsVideoRef.current.readyState >= 2) {
        // HLS playout: video.currentTime is relative to the transcode start;
        // add the file offset we started from so it aligns with SRT timestamps.
        currentSec = hlsVideoRef.current.currentTime + hlsPlayoutStartRef.current;
      } else if (videoRef.current && !videoRef.current.paused) {
        currentSec = videoRef.current.currentTime;
      } else {
        // Fallback: wall-clock elapsed since programme start
        currentSec = localProgress;
      }
      const adjustedTime = currentSec + (subOffsetMs / 1000);
      const match = currentCues.find(c => adjustedTime >= c.start && adjustedTime <= c.end);
      setActiveCueText(match ? match.text : "");
    };

    const interval = setInterval(updateCue, 200);
    return () => clearInterval(interval);
  }, [localProgress, currentCues, subOffsetMs]);

  // Handle audio track change: for direct playout use HTMLMediaElement API; for HLS restart transcode with new track
  const handleAudioTrackSelect = (track: AudioStreamInfo, newIdx: number) => {
    const prevIdx = selectedAudioTrackIdx;
    setSelectedAudioTrackIdx(newIdx);
    setShowAudioMenu(false);
    setShowTelemetryAudioMenu(false);

    if (isWebCompatible && !directVideoFailed) {
      // Direct playout: try HTMLMediaElement.audioTracks (WebKit)
      if (videoRef.current && (videoRef.current as any).audioTracks) {
        const at = (videoRef.current as any).audioTracks;
        for (let i = 0; i < at.length; i++) {
          at[i].enabled = (i === newIdx);
        }
      }
    } else if (hlsSrc && activeEntry?.file_path && newIdx !== prevIdx) {
      // HLS: restart transcode with the selected audio track index
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
      setHlsSrc("");
      currentPlayingFileRef.current = null;
      invoke<string>("start_transcode", {
        filePath: activeEntry.file_path,
        startTimeSec: targetSec,
        audioTrackIndex: track.index,
      })
        .then(() => setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}&a=${newIdx}`))
        .catch((err) => console.error("Audio track switch transcode failed:", err));
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useKeyboardShortcuts({
    " ": useCallback((e) => {
      e.preventDefault();
      setIsMuted(m => !m);
    }, []),
    "s": useCallback(() => {
      // Cycle to next subtitle track (or off)
      if (subtitles.length === 0) return;
      const opts = ["off", ...subtitles.map(s => s.id)];
      const currentIdx = opts.indexOf(selectedSubtitleId);
      const next = opts[(currentIdx + 1) % opts.length];
      setSelectedSubtitleId(next);
    }, [subtitles, selectedSubtitleId]),
    "S": useCallback(() => {
      if (subtitles.length === 0) return;
      const opts = ["off", ...subtitles.map(s => s.id)];
      const currentIdx = opts.indexOf(selectedSubtitleId);
      const next = opts[(currentIdx + 1) % opts.length];
      setSelectedSubtitleId(next);
    }, [subtitles, selectedSubtitleId]),
    "a": useCallback(() => {
      if (availableAudioTracks.length < 2) return;
      const nextIdx = (selectedAudioTrackIdx + 1) % availableAudioTracks.length;
      handleAudioTrackSelect(availableAudioTracks[nextIdx], nextIdx);
    }, [availableAudioTracks, selectedAudioTrackIdx, handleAudioTrackSelect]),
    "A": useCallback(() => {
      if (availableAudioTracks.length < 2) return;
      const nextIdx = (selectedAudioTrackIdx + 1) % availableAudioTracks.length;
      handleAudioTrackSelect(availableAudioTracks[nextIdx], nextIdx);
    }, [availableAudioTracks, selectedAudioTrackIdx, handleAudioTrackSelect]),
  });

  // Inspect item details for schedule line-up
  const inspectTarget = selectedInspectorItem || hoveredItem || activeEntry;

  useEffect(() => {
    if (!inspectTarget?.media_item_id) {
      setInspectorSubtitles([]);
      setInspectorAudioTracks([]);
      return;
    }

    invoke<SubtitleRecordInfo[]>("get_media_subtitles", {
      mediaItemId: inspectTarget.media_item_id,
      filePath: inspectTarget.file_path || null,
    })
      .then(res => setInspectorSubtitles(res || []))
      .catch(() => setInspectorSubtitles([]));

    // Probe real audio streams for the inspected item
    if (inspectTarget.file_path) {
      invoke<{ audio: AudioStreamInfo[] }>("list_media_streams", { path: inspectTarget.file_path })
        .then(streams => setInspectorAudioTracks(streams.audio || []))
        .catch(() => setInspectorAudioTracks([]));
    } else {
      setInspectorAudioTracks([]);
    }
  }, [inspectTarget?.media_item_id, inspectTarget?.file_path]);

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

  // Clean up transcoder on unmount
  useEffect(() => {
    return () => {
      invoke("stop_transcode").catch((err) => console.error("Transcoder unmount cleanup failed:", err));
    };
  }, []);

  const currentPlayingFileRef = useRef<string | null>(null);

  // Playout management: start/stop transcode as the EPG active item changes.
  // IMPORTANT: pausing the monitor (monitorActive=false) only freezes the local
  // video element — it does NOT stop_transcode, so TV Client and Browser Player
  // continue running from the same HLS stream.
  useEffect(() => {
    const activeFilePath = playoutState?.active_entry?.file_path;
    const shouldUseHls = (!isWebCompatible || directVideoFailed) && !isAudioOnly;

    if (activeFilePath && shouldUseHls) {
      // Same file still running — don't restart
      if (currentPlayingFileRef.current === activeFilePath && hlsSrc) {
        return;
      }
      currentPlayingFileRef.current = activeFilePath;
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
      hlsPlayoutStartRef.current = targetSec;
      invoke<string>("start_transcode", {
        filePath: activeFilePath,
        startTimeSec: targetSec,
        audioTrackIndex: null,
      })
      .then(() => {
        setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}`);
      })
      .catch((err) => {
        console.warn("Transcoder launch failed:", err);
        setHlsSrc("");
      });
    } else if (activeFilePath && !shouldUseHls) {
      // Direct playout for web-compatible files — stop any running transcode
      currentPlayingFileRef.current = null;
      invoke("stop_transcode").catch(() => {});
      setHlsSrc("");
    } else if (!activeFilePath) {
      // Nothing scheduled — stop transcode
      currentPlayingFileRef.current = null;
      invoke("stop_transcode").catch(() => {});
      setHlsSrc("");
    }
    // NOTE: monitorActive is intentionally NOT in the dep array here.
    // Pausing the monitor does not affect the shared transcode.
  }, [playoutState?.active_entry?.file_path, isWebCompatible, directVideoFailed, isAudioOnly]);

  // Keep monitorActiveRef in sync so event handlers always see the current value
  useEffect(() => { monitorActiveRef.current = monitorActive; }, [monitorActive]);

  // When the monitor is paused/resumed, only affect the local video element
  useEffect(() => {
    if (!monitorActive) {
      // Pause local video elements without stopping the transcode
      hlsVideoRef.current?.pause();
      videoRef.current?.pause();
    } else {
      // Resume local video elements
      hlsVideoRef.current?.play().catch(() => {});
      videoRef.current?.play().catch(() => {});
    }
  }, [monitorActive]);

  // Synchronize direct video playout offset
  useEffect(() => {
    if (monitorActive && activeEntry && isWebCompatible && !directVideoFailed && videoRef.current) {
      const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : localProgress;
      const currentVideoTime = videoRef.current.currentTime;
      if (Math.abs(currentVideoTime - targetSec) > 2.0) {
        videoRef.current.currentTime = targetSec;
      }
      videoRef.current.play().catch(err => console.warn("Direct playout auto-play warning:", err));
    }
  }, [playoutState?.active_entry?.id, monitorActive, isWebCompatible, directVideoFailed, localProgress]);

  const toggleFullscreen = () => {
    if (!monitorContainerRef.current) return;
    if (!document.fullscreenElement) {
      monitorContainerRef.current.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen().catch(err => console.error(err));
    }
  };

  const formatRuntime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };

  const progressPercent = activeEntry?.duration && activeEntry.duration > 0
    ? Math.min(100, Math.max(0, (localProgress / activeEntry.duration) * 100))
    : 0;

  return (
    <div className="flex-1 h-screen flex flex-col bg-background text-gray-200 font-mono select-none overflow-hidden">
      {/* TOP HEADER: CHANNEL STATUS & BROADCAST CLOCK */}
      <header className="h-14 border-b border-gray-800/80 bg-gray-950/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-onair animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.8)]" />
            <span className="text-sm font-black tracking-widest text-onair">ON AIR</span>
          </div>
          <div className="h-4 w-px bg-gray-800" />

          {/* ── Channel Switcher ───────────────────────────────────── */}
          <div className="relative">
            <button
              onClick={() => { setShowChannelMenu(v => !v); setShowNewChannelForm(false); }}
              className="flex items-center space-x-1.5 text-xs font-bold text-gray-200 bg-gray-900 border border-gray-700 hover:border-accent/50 hover:text-accent transition-all px-3 py-1.5 rounded tracking-wider"
              title="Switch Channel"
            >
              <Radio size={13} className="text-accent" />
              <span>{channels.find(c => c.id === activeChannelId)?.name || "MAIN CHANNEL"}</span>
              <ChevronDown size={12} className={`transition-transform ${showChannelMenu ? "rotate-180" : ""}`} />
            </button>

            {showChannelMenu && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-50 overflow-hidden">
                {/* Channel list */}
                <div className="max-h-48 overflow-y-auto">
                  {channels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => { setActiveChannelId(ch.id); setShowChannelMenu(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-mono hover:bg-gray-800 transition-colors ${activeChannelId === ch.id ? "text-accent bg-accent/5" : "text-gray-300"}`}
                    >
                      <span className="flex items-center space-x-2">
                        {activeChannelId === ch.id && <Check size={11} className="text-accent" />}
                        {activeChannelId !== ch.id && <span className="w-[11px]" />}
                        <span>{ch.name}</span>
                      </span>
                      <span className="text-[9px] text-gray-600 font-bold">{ch.profile_name?.toUpperCase() || "MIXED"}</span>
                      {ch.id !== "chan_default" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteChannel(ch.id); }}
                          className="ml-2 text-rose-500/60 hover:text-rose-400 transition-colors"
                          title="Delete channel"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </button>
                  ))}
                </div>

                <div className="border-t border-gray-800 p-2">
                  {!showNewChannelForm ? (
                    <button
                      onClick={() => setShowNewChannelForm(true)}
                      className="w-full flex items-center space-x-1.5 text-[10px] font-bold text-accent hover:bg-accent/10 px-2 py-1.5 rounded transition-colors"
                    >
                      <Plus size={12} />
                      <span>NEW CHANNEL</span>
                    </button>
                  ) : (
                    <div className="space-y-1.5 p-1">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Channel name..."
                        value={newChannelName}
                        onChange={e => setNewChannelName(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] text-accent font-mono focus:outline-none focus:border-accent"
                      />
                      <select
                        value={newChannelProfile}
                        onChange={e => setNewChannelProfile(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300 font-mono focus:outline-none focus:border-accent"
                      >
                        {["Mixed Family Channel","Classic Movie Channel","Documentary Channel","Anime Channel","Educational Channel"].map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <div className="flex space-x-1.5">
                        <button
                          onClick={() => { setShowNewChannelForm(false); setNewChannelName(""); }}
                          className="flex-1 text-[9px] font-bold text-gray-500 hover:text-gray-300 py-1 rounded border border-gray-800 transition-colors"
                        >CANCEL</button>
                        <button
                          disabled={!newChannelName.trim() || channelActionLoading}
                          onClick={async () => {
                            if (!newChannelName.trim()) return;
                            setChannelActionLoading(true);
                            try {
                              await createChannel(newChannelName.trim(), newChannelProfile);
                              setNewChannelName("");
                              setShowNewChannelForm(false);
                              setShowChannelMenu(false);
                            } finally {
                              setChannelActionLoading(false);
                            }
                          }}
                          className="flex-1 text-[9px] font-bold text-background bg-accent hover:bg-cyan-400 py-1 rounded transition-colors disabled:opacity-50"
                        >CREATE</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* ── End Channel Switcher ───────────────────────────────── */}
        </div>

        <div className="flex items-center space-x-4">
          {/* Quick Action Navigation */}
          <button
            onClick={() => invoke("open_tv_window").catch(err => console.error(err))}
            className="flex items-center space-x-1.5 text-xs font-bold text-onair bg-onair/10 border border-onair/30 hover:bg-onair hover:text-black transition-all px-3 py-1.5 rounded tracking-wider cursor-pointer"
            title="Open Dedicated TV Window"
          >
            <Tv size={13} />
            <span>GO TO TV</span>
          </button>
          {/* Browser Player Link */}
          <div className="flex items-center rounded border border-gray-700 overflow-hidden text-xs font-bold">
            <span className="px-2 py-1.5 text-[10px] text-gray-500 bg-gray-900 border-r border-gray-700 tracking-widest select-all" title={playerUrl}>
              :8098/player
            </span>
            <button
              onClick={handleCopyPlayerUrl}
              className={`flex items-center space-x-1 px-2.5 py-1.5 transition-all ${
                urlCopied ? "bg-emerald-600 text-white" : "bg-gray-900 text-gray-400 hover:text-accent hover:bg-gray-800"
              }`}
              title="Copy browser player link"
            >
              {urlCopied ? <Check size={11} /> : <Copy size={11} />}
              <span>{urlCopied ? "COPIED" : "COPY"}</span>
            </button>
            <a
              href={playerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-gray-900 text-gray-400 hover:text-accent hover:bg-gray-800 transition-all border-l border-gray-700"
              title="Open in browser"
            >
              <ExternalLink size={11} />
            </a>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "grid" }))}
            className="flex items-center space-x-1.5 text-xs font-bold text-accent bg-accent/10 border border-accent/30 hover:bg-accent hover:text-black transition-all px-3 py-1.5 rounded tracking-wider cursor-pointer"
            title="Open Schedule Grid"
          >
            <Calendar size={13} />
            <span>SCHEDULER</span>
          </button>

          <div className="h-4 w-px bg-gray-800" />

          {/* Master Clock */}
          <div className="flex items-center space-x-2 bg-gray-900/90 border border-gray-800 px-3 py-1 rounded shadow-inner">
            <Clock size={14} className="text-accent" />
            <span className="text-xs text-accent font-bold tracking-wider">{timeStr}</span>
          </div>
        </div>
      </header>


      {/* MAIN STUDIO WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT COLUMN: LIVE STUDIO MONITOR & TELEMETRY */}
        <div className="flex-1 flex flex-col justify-between p-6 space-y-4 overflow-y-auto border-r border-gray-800/80">
          {/* Studio Monitor Screen */}
          <div 
            ref={monitorContainerRef}
            className="w-full aspect-video bg-black rounded-xl border border-gray-800 relative overflow-hidden flex items-center justify-center group shadow-2xl shrink-0"
            onMouseEnter={() => setShowPlayerOverlay(true)}
            onMouseLeave={() => {
              setShowPlayerOverlay(false);
              setShowAudioMenu(false);
              setShowSubMenu(false);
            }}
            onMouseMove={() => setShowPlayerOverlay(true)}
          >
            {activeEntry?.file_path ? (
              monitorActive ? (
                isWebCompatible && !directVideoFailed ? (
                  /* High-Performance Direct Hardware Playout (MP4 / MOV / M4V / MP3 / AAC) */
                  <div className="w-full h-full relative flex items-center justify-center bg-black">
                    <video
                      ref={videoRef}
                      src={convertFileSrc(activeEntry.file_path)}
                      className="w-full h-full object-contain"
                      autoPlay
                      muted={isMuted}
                      loop={false}
                      onError={() => {
                        console.warn("Direct playout failed, falling back to HLS stream transcode...");
                        setDirectVideoFailed(true);
                      }}
                    >
                      {vttTrackUrl && (
                        <track src={vttTrackUrl} kind="subtitles" srcLang="en" label="Subtitles" default />
                      )}
                    </video>
                  </div>
                ) : (
                  /* Universal HLS Stream Playout (MKV / TS / AVI / Transcoded) */
                  <div className="w-full h-full relative flex items-center justify-center bg-zinc-950">
                    {hlsSrc ? (
                      <video
                        ref={hlsVideoRef}
                        src={hlsSrc}
                        className="w-full h-full object-contain"
                        muted={isMuted}
                        playsInline
                        crossOrigin="anonymous"
                        onCanPlay={(e) => {
                          // Only auto-play if the monitor is active — prevents
                          // audio restarting when a new EPG item loads while
                          // the monitor is paused.
                          if (monitorActiveRef.current) {
                            (e.target as HTMLVideoElement).play().catch((err) => console.warn("HLS play error:", err));
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-black/90 space-y-3 p-6 text-center">
                        <RefreshCw size={28} className="text-onair animate-spin" />
                        <div className="text-onair text-xs font-bold tracking-widest uppercase">
                          INITIALIZING LIVE BROADCAST FEED...
                        </div>
                        <div className="text-[10px] text-gray-500 max-w-xs leading-relaxed font-mono">
                          Transcoding container stream & buffering broadcast segments...
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Monitor Standby Toggle */
                <div 
                  onClick={() => setMonitorActive(true)}
                  className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center cursor-pointer space-y-3 hover:bg-zinc-900 transition-all duration-300 border border-gray-800 rounded-lg group p-8 text-center"
                >
                  <div className="w-14 h-14 rounded-full bg-accent/5 border border-accent/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-accent/15 group-hover:border-accent/50 transition-all duration-300 shadow-inner">
                    <Play size={24} className="text-accent fill-accent ml-1" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-accent text-xs font-bold tracking-widest uppercase">
                      RESUME LIVE MONITOR FEED
                    </div>
                    <div className="text-[10px] text-gray-500">
                      Click to connect studio monitor to the live broadcast output.
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* SMPTE Color Bars Pattern when no active content */
              <div className="w-full h-full relative flex flex-col justify-between p-8 font-mono bg-zinc-900 border border-zinc-800 overflow-hidden">
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
                
                <div className="z-10 bg-black/85 p-5 border border-gray-800 rounded-lg max-w-sm mx-auto my-auto text-center space-y-2 shadow-2xl backdrop-blur-md">
                  <div className="text-onair font-black tracking-widest text-sm animate-pulse">NO CONTENT CURRENTLY ON AIR</div>
                  <div className="text-[10px] text-gray-400">
                    Schedule content on the grid or enable automated channel playout.
                  </div>
                  {nextEntry && (
                    <div className="text-[10px] text-accent font-bold pt-1">
                      Next up: {nextEntry.item_title} ({Math.round((new Date(nextEntry.start_time).getTime() - new Date().getTime()) / 60000)}m)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LIVE SUBTITLE ON-SCREEN DISPLAY */}
            {activeCueText && monitorActive && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-black/90 text-yellow-300 font-sans font-bold text-sm px-5 py-2 rounded-lg border border-yellow-500/40 shadow-2xl backdrop-blur-md pointer-events-none z-30 max-w-[85%] text-center leading-relaxed">
                {activeCueText}
              </div>
            )}

            {/* FLOATING TOP BADGES */}
            {activeEntry && monitorActive && (
              <div className="absolute top-3 left-3 flex items-center space-x-2 z-20 pointer-events-none">
                <div className="flex items-center space-x-1.5 text-[9px] bg-black/80 backdrop-blur-md border border-gray-800 px-2.5 py-1 rounded text-white font-bold shadow">
                  <span className="w-2 h-2 rounded-full bg-onair animate-pulse" />
                  <span className="text-onair font-extrabold tracking-wider">LIVE FEED</span>
                </div>
                {isWebCompatible && !directVideoFailed ? (
                  <span className="text-[9px] bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 font-bold px-2 py-0.5 rounded">
                    DIRECT HARDWARE PLAYOUT
                  </span>
                ) : (
                  <span className="text-[9px] bg-purple-950/80 border border-purple-500/30 text-purple-300 font-bold px-2 py-0.5 rounded">
                    HLS TRANSCODE
                  </span>
                )}
              </div>
            )}

            {/* RE-WORKED REFINED MEDIA PLAYER MENU OVERLAY */}
            {activeEntry && monitorActive && (
              <div className={`absolute top-3 right-3 flex items-center space-x-2 z-30 transition-opacity duration-200 ${
                showPlayerOverlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}>
                {/* Audio Language Selector */}
                <div className="relative">
                  <button
                    onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/85 hover:bg-black text-xs text-gray-200 border border-gray-700/80 hover:border-accent rounded-md transition-all shadow-xl backdrop-blur-md cursor-pointer"
                    title="Audio Language Selection"
                  >
                    <Globe size={13} className="text-accent" />
                    <span className="text-[10.5px] font-bold max-w-[90px] truncate">
                      {availableAudioTracks[selectedAudioTrackIdx]
                        ? buildAudioLabel(availableAudioTracks[selectedAudioTrackIdx])
                        : "Audio"}
                    </span>
                    <ChevronDown size={11} className="text-gray-400" />
                  </button>

                  {showAudioMenu && (
                    <div className="absolute top-full right-0 mt-1.5 w-56 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1.5 font-sans text-xs backdrop-blur-lg">
                      <div className="px-3 py-1 text-[9px] font-extrabold text-gray-400 border-b border-gray-800 uppercase tracking-wider">
                        Audio Track
                      </div>
                      {availableAudioTracks.map((trk, i) => (
                        <button
                          key={trk.index}
                          onClick={() => handleAudioTrackSelect(trk, i)}
                          className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800/80 transition-colors ${
                            selectedAudioTrackIdx === i ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                          }`}
                        >
                          <span className="truncate">{buildAudioLabel(trk)}</span>
                          {selectedAudioTrackIdx === i && <Check size={12} className="text-accent shrink-0 ml-1" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Subtitles Track Selector & Sync */}
                <div className="relative">
                  <button
                    onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/85 hover:bg-black text-xs text-gray-200 border border-gray-700/80 hover:border-accent rounded-md transition-all shadow-xl backdrop-blur-md cursor-pointer"
                    title="Subtitle Track Selection"
                  >
                    <Subtitles size={13} className="text-accent" />
                    <span className="text-[10.5px] font-bold max-w-[100px] truncate">
                      {selectedSubtitleId === "off"
                        ? "Subs: Off"
                        : subtitles.find(s => s.id === selectedSubtitleId)?.language.toUpperCase() || "Subtitles"}
                    </span>
                    <ChevronDown size={11} className="text-gray-400" />
                  </button>

                  {showSubMenu && (
                    <div className="absolute top-full right-0 mt-1.5 w-56 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1.5 font-sans text-xs backdrop-blur-lg">
                      <div className="px-3 py-1 text-[9px] font-extrabold text-gray-400 border-b border-gray-800 uppercase tracking-wider">
                        Subtitles
                      </div>
                      <button
                        onClick={() => { setSelectedSubtitleId("off"); setShowSubMenu(false); }}
                        className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800/80 transition-colors ${
                          selectedSubtitleId === "off" ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                        }`}
                      >
                        <span>Disabled (Off)</span>
                        {selectedSubtitleId === "off" && <Check size={12} className="text-accent shrink-0" />}
                      </button>

                      {subtitles.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => { setSelectedSubtitleId(sub.id); setShowSubMenu(false); }}
                          className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800/80 transition-colors ${
                            selectedSubtitleId === sub.id ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                          }`}
                        >
                          <span className="truncate">{sub.label}</span>
                          {selectedSubtitleId === sub.id && <Check size={12} className="text-accent shrink-0 ml-1" />}
                        </button>
                      ))}

                      {selectedSubtitleId !== "off" && (
                        <div className="border-t border-gray-800 px-3 py-2 mt-1.5 bg-gray-900/60 flex flex-col space-y-1.5">
                          <div className="flex justify-between items-center text-[9px] font-bold text-gray-400">
                            <span>SYNC OFFSET</span>
                            <span className="text-accent font-mono">{subOffsetMs > 0 ? `+${subOffsetMs}ms` : `${subOffsetMs}ms`}</span>
                          </div>
                          <div className="flex items-center justify-between space-x-1 font-mono">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSubOffsetMs((prev) => prev - 250); }}
                              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-200 rounded cursor-pointer"
                              title="Delay -250ms"
                            >
                              -250ms
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSubOffsetMs(0); }}
                              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-400 hover:text-gray-200 rounded cursor-pointer"
                              title="Reset offset"
                            >
                              0ms
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSubOffsetMs((prev) => prev + 250); }}
                              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-200 rounded cursor-pointer"
                              title="Advance +250ms"
                            >
                              +250ms
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Resync Stream */}
                <button
                  onClick={() => {
                    const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
                    if (videoRef.current) {
                      videoRef.current.currentTime = targetSec;
                    }
                    if (hlsSrc) {
                      setHlsSrc("");
                      invoke<string>("start_transcode", {
                        filePath: activeEntry.file_path,
                        startTimeSec: targetSec,
                        audioTrackIndex: null,
                      })
                      .then(() => {
                        setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}`);
                      })
                      .catch((err) => console.error("Resync failed:", err));
                    }
                  }}
                  className="p-1.5 px-2.5 bg-black/85 hover:bg-black text-accent border border-gray-700/80 hover:border-accent rounded-md transition-all text-[10.5px] font-bold shadow-xl backdrop-blur-md flex items-center space-x-1 cursor-pointer"
                  title="Resync to exact schedule time"
                >
                  <RefreshCw size={12} />
                  <span>SYNC</span>
                </button>

                {/* Audio Mute/Unmute */}
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-1.5 px-2 bg-black/85 hover:bg-black text-gray-200 border border-gray-700/80 hover:border-accent rounded-md transition-all shadow-xl backdrop-blur-md cursor-pointer"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
                </button>

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="p-1.5 px-2 bg-black/85 hover:bg-black text-gray-200 border border-gray-700/80 hover:border-accent rounded-md transition-all shadow-xl backdrop-blur-md cursor-pointer"
                  title="Fullscreen Monitor"
                >
                  <Maximize2 size={14} />
                </button>

                {/* Pause Monitor */}
                <button
                  onClick={() => setMonitorActive(false)}
                  className="p-1.5 px-2 bg-black/85 hover:bg-black text-red-400 border border-red-500/40 hover:border-red-500 rounded-md transition-all shadow-xl backdrop-blur-md cursor-pointer"
                  title="Pause Monitor"
                >
                  <StopCircle size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Broadcast Telemetry Panel (Interactive Language & Subtitle Pickers) */}
          <div className="bg-panel border border-gray-800/90 rounded-xl p-5 space-y-4 shadow-xl shrink-0">
            <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
              <span className="text-[10px] font-extrabold tracking-widest text-gray-400 uppercase">
                NOW PLAYING TELEMETRY
              </span>
              <div className="flex items-center space-x-1.5 text-emerald-400 text-[10px] font-bold">
                <Eye size={12} />
                <span>BROADCAST STABLE</span>
              </div>
            </div>

            {activeEntry ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-bold text-accent leading-tight">{activeEntry.item_title}</h2>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-lg">
                      {activeEntry.file_path}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-onair/15 text-onair border border-onair/30 font-bold text-[10px]">
                    LIVE
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-400 font-mono font-bold">
                    <span>{formatRuntime(localProgress)}</span>
                    <span>{progressPercent.toFixed(1)}%</span>
                    <span>-{remainingTimeStr}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
                    <div 
                      className="h-full bg-gradient-to-r from-accent to-onair transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Interactive Technical Meta Grid */}
                <div className="grid grid-cols-3 gap-3 pt-2 text-[10px] text-gray-400 border-t border-gray-800/80">
                  {/* Interactive Audio Track Selector */}
                  <div className="relative bg-gray-950/60 p-2.5 rounded border border-gray-900 hover:border-accent/40 transition-all cursor-pointer"
                       onClick={() => { setShowTelemetryAudioMenu(!showTelemetryAudioMenu); setShowTelemetrySubMenu(false); }}>
                    <div className="flex justify-between items-center text-[8.5px] text-gray-500 uppercase font-bold">
                      <span>AUDIO LANGUAGE</span>
                      <ChevronDown size={10} />
                    </div>
                    <div className="font-bold text-gray-200 truncate mt-0.5 flex items-center space-x-1">
                      <Globe size={11} className="text-accent shrink-0" />
                      <span className="truncate">
                        {availableAudioTracks[selectedAudioTrackIdx]
                          ? buildAudioLabel(availableAudioTracks[selectedAudioTrackIdx])
                          : "—"}
                      </span>
                    </div>

                    {showTelemetryAudioMenu && (
                      <div 
                        className="absolute bottom-full left-0 mb-1 w-56 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1 font-sans text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase">
                          Select Audio Track
                        </div>
                        {availableAudioTracks.map((trk, i) => (
                          <button
                            key={trk.index}
                            onClick={() => handleAudioTrackSelect(trk, i)}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                              selectedAudioTrackIdx === i ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                            }`}
                          >
                            <span className="truncate">{buildAudioLabel(trk)}</span>
                            {selectedAudioTrackIdx === i && <Check size={12} className="text-accent" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Interactive Subtitles Selector */}
                  <div className="relative bg-gray-950/60 p-2.5 rounded border border-gray-900 hover:border-accent/40 transition-all cursor-pointer"
                       onClick={() => { setShowTelemetrySubMenu(!showTelemetrySubMenu); setShowTelemetryAudioMenu(false); }}>
                    <div className="flex justify-between items-center text-[8.5px] text-gray-500 uppercase font-bold">
                      <span>SUBTITLES</span>
                      <ChevronDown size={10} />
                    </div>
                    <div className="font-bold text-gray-200 truncate mt-0.5 flex items-center space-x-1">
                      <Subtitles size={11} className="text-accent shrink-0" />
                      <span className="truncate">
                        {selectedSubtitleId === "off" ? "OFF" : (subtitles.find(s => s.id === selectedSubtitleId)?.label || "ACTIVE")}
                      </span>
                    </div>

                    {showTelemetrySubMenu && (
                      <div 
                        className="absolute bottom-full left-0 mb-1 w-56 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1 font-sans text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase">
                          Select Subtitle
                        </div>
                        <button
                          onClick={() => { setSelectedSubtitleId("off"); setShowTelemetrySubMenu(false); }}
                          className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                            selectedSubtitleId === "off" ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                          }`}
                        >
                          <span>Off</span>
                          {selectedSubtitleId === "off" && <Check size={12} className="text-accent" />}
                        </button>
                        {subtitles.map((sub) => (
                          <button
                            key={sub.id}
                            onClick={() => { setSelectedSubtitleId(sub.id); setShowTelemetrySubMenu(false); }}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                              selectedSubtitleId === sub.id ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                            }`}
                          >
                            <span className="truncate">{sub.label}</span>
                            {selectedSubtitleId === sub.id && <Check size={12} className="text-accent ml-1 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Next Program Indicator */}
                  <div className="bg-gray-950/60 p-2.5 rounded border border-gray-900">
                    <div className="text-[8.5px] text-gray-500 uppercase font-bold">NEXT PROGRAM</div>
                    <div className="font-bold text-accent truncate mt-0.5">
                      {nextEntry ? nextEntry.item_title : "STANDBY"}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-600 text-xs font-mono">
                No active program currently playing. Playout telemetry is in standby.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: TODAY'S BROADCAST SCHEDULE & INTERACTIVE INSPECTOR */}
        <div className="w-[430px] shrink-0 flex flex-col justify-between p-6 space-y-4 bg-gray-950/40">
          <div className="space-y-3 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2.5 shrink-0">
              <span className="text-xs font-black tracking-widest text-accent uppercase">
                SCHEDULE LINEUP (TODAY)
              </span>
              <span className="text-[10px] text-gray-500 font-bold">
                {comingPrograms.length} PROGRAMS
              </span>
            </div>

            {/* Scrollable Schedule Queue */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
              {comingPrograms.length > 0 ? (
                comingPrograms.map((program) => {
                  const isActive = activeEntry && program.id === activeEntry.id;
                  const isSelected = selectedInspectorItem?.id === program.id;
                  return (
                    <div 
                      key={program.id}
                      className={`p-3 rounded-lg relative transition-all duration-150 border cursor-pointer ${
                        isActive 
                          ? "bg-onair/10 border-onair/50 shadow-[0_0_12px_rgba(249,115,22,0.15)]" 
                          : isSelected
                          ? "bg-accent/10 border-accent/60"
                          : "bg-panel/80 border-gray-800/80 hover:border-accent/40 hover:bg-panel"
                      }`}
                      onClick={() => setSelectedInspectorItem(program)}
                      onMouseEnter={() => setHoveredItem(program)}
                      onMouseLeave={() => setHoveredItem(null)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-gray-500 font-mono font-bold">
                          {new Date(program.start_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })} - {new Date(program.end_time).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </div>
                        {isActive && (
                          <div className="text-[8.5px] font-black text-onair bg-onair/20 px-1.5 py-0.5 rounded tracking-widest animate-pulse">
                            ON AIR NOW
                          </div>
                        )}
                      </div>

                      <div className={`text-xs font-bold mt-1 line-clamp-1 ${isActive ? "text-gray-100" : "text-gray-300"}`}>
                        {program.item_title}
                      </div>

                      <div className="text-[9px] mt-1.5 flex items-center justify-between text-gray-500 font-mono">
                        <div className="flex items-center space-x-2">
                          <span className="px-1.5 py-0.2 bg-gray-900 rounded border border-gray-800 uppercase font-bold text-gray-400">
                            {program.media_type}
                          </span>
                          <span>{formatRuntime(program.duration)}</span>
                        </div>
                        <span className="text-gray-600 hover:text-accent text-[8.5px]">Click to inspect</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 bg-gray-950 border border-dashed border-gray-800 rounded-lg text-center text-gray-500 text-xs flex flex-col items-center justify-center space-y-2">
                  <AlertTriangle className="text-onair" size={20} />
                  <span>NO SCHEDULED CONTENT FOR TODAY</span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Inspector Card with Language & Subtitle Selector */}
          <div className="bg-panel border border-gray-800/90 rounded-xl p-3.5 min-h-[170px] flex flex-col justify-between relative shrink-0 shadow-lg">
            <div className="flex justify-between items-center border-b border-gray-800 pb-1.5 mb-2">
              <span className="text-[9px] font-extrabold text-accent uppercase tracking-wider flex items-center space-x-1">
                <Sparkles size={11} />
                <span>PROGRAM INSPECTOR & AUDIO/SUBTITLES</span>
              </span>
              {selectedInspectorItem && (
                <button 
                  onClick={() => setSelectedInspectorItem(null)}
                  className="text-[9px] text-gray-500 hover:text-gray-300 cursor-pointer"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {inspectTarget ? (
              <div className="space-y-2.5">
                <div className="flex items-start space-x-3">
                  <img 
                    src={(inspectTarget.duration !== 0 && inspectTarget.poster_path) ? getPosterUrl(inspectTarget.poster_path) : getFallbackPosterUrl(inspectTarget.media_item_id)} 
                    alt="Poster" 
                    className="w-12 h-16 object-cover rounded border border-gray-800 shadow shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-bold text-gray-100 truncate">{inspectTarget.item_title}</div>
                    <div className="text-[9px] text-gray-400 space-y-0.5 font-mono">
                      <div>AIRTIME: {new Date(inspectTarget.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(inspectTarget.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div>DURATION: {formatRuntime(inspectTarget.duration)}</div>
                    </div>
                  </div>
                </div>

                {/* Language & Subtitles Selection for Inspected Movie */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-800/70 font-sans text-xs">
                  {/* Audio Track Selector */}
                  <div>
                    <label className="text-[8.5px] font-bold text-gray-500 uppercase block mb-1">
                      Audio Track
                    </label>
                    <select
                      value={
                        activeEntry?.id === inspectTarget.id
                          ? String(selectedAudioTrackIdx)
                          : "0"
                      }
                      onChange={(e) => {
                        const i = parseInt(e.target.value, 10);
                        const tracks = activeEntry?.id === inspectTarget.id
                          ? availableAudioTracks
                          : inspectorAudioTracks;
                        const trk = tracks[i];
                        if (trk && activeEntry?.id === inspectTarget.id) {
                          handleAudioTrackSelect(trk, i);
                        }
                      }}
                      className="w-full bg-gray-950 border border-gray-800 hover:border-accent text-gray-200 text-[10px] rounded p-1 font-mono focus:outline-none cursor-pointer"
                    >
                      {(activeEntry?.id === inspectTarget.id ? availableAudioTracks : inspectorAudioTracks).map((trk, i) => (
                        <option key={trk.index} value={String(i)}>{buildAudioLabel(trk)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Subtitles Selector */}
                  <div>
                    <label className="text-[8.5px] font-bold text-gray-500 uppercase block mb-1">
                      Subtitles
                    </label>
                    <select
                      value={activeEntry?.id === inspectTarget.id ? selectedSubtitleId : (inspectorSubtitles[0]?.id || "off")}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (activeEntry?.id === inspectTarget.id) {
                          setSelectedSubtitleId(val);
                        }
                      }}
                      className="w-full bg-gray-950 border border-gray-800 hover:border-accent text-gray-200 text-[10px] rounded p-1 font-mono focus:outline-none cursor-pointer"
                    >
                      <option value="off">Off (Disabled)</option>
                      {inspectorSubtitles.map(sub => (
                        <option key={sub.id} value={sub.id}>{sub.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center my-auto text-gray-600 text-xs font-mono">
                Click or hover a scheduled movie to inspect and select audio & subtitles.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
