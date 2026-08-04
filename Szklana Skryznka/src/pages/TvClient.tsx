import React, { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useChannelStore } from "../store";
import { Globe, Subtitles, ChevronDown, Check, PlayCircle, RefreshCw } from "lucide-react";

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

export const TvClient: React.FC = () => {
  const { playoutState, fetchPlayoutState, channels, fetchChannels } = useChannelStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsSrc, setHlsSrc] = useState<string>("");

  // Subtitles & Audio Track state
  const [subtitles, setSubtitles] = useState<SubtitleRecord[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("off");
  const [currentCues, setCurrentCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string>("");
  const [vttTrackUrl, setVttTrackUrl] = useState<string>("");
  const [showControls, setShowControls] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);

  const [availableAudioTracks, setAvailableAudioTracks] = useState<string[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string>("default");
  const [showAudioMenu, setShowAudioMenu] = useState(false);

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

  const [forceVlcMode, setForceVlcMode] = useState(false);

  const activeEntry = playoutState?.active_entry;
  const isWebCompatibleRaw = activeEntry?.file_path
    ? (activeEntry.file_path.toLowerCase().endsWith(".mp4") ||
       activeEntry.file_path.toLowerCase().endsWith(".m4v") ||
       activeEntry.file_path.toLowerCase().endsWith(".mov") ||
       activeEntry.file_path.toLowerCase().endsWith(".webm") ||
       activeEntry.file_path.toLowerCase().endsWith(".mp3") ||
       activeEntry.file_path.toLowerCase().endsWith(".aac") ||
       activeEntry.file_path.toLowerCase().endsWith(".wav") ||
       activeEntry.file_path.toLowerCase().endsWith(".flac")) &&
      !activeEntry.file_path.toLowerCase().includes("_av1") &&
      !activeEntry.file_path.toLowerCase().includes("av1")
    : false;

  const isWebCompatible = isWebCompatibleRaw && !forceVlcMode;

  useEffect(() => {
    setForceVlcMode(false);
  }, [activeEntry?.id]);

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
        console.error("Failed to fetch subtitles in TV client:", err);
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
        console.error("Failed to load subtitle file in TV Client:", err);
        setCurrentCues([]);
        setVttTrackUrl("");
      });
  }, [selectedSubtitleId, subtitles]);

  // Update active subtitle cue text on video timeupdate
  useEffect(() => {
    if (currentCues.length === 0) {
      setActiveCueText("");
      return;
    }

    const updateCue = () => {
      const currentSec = videoRef.current
        ? videoRef.current.currentTime
        : (playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0);
      const match = currentCues.find(c => currentSec >= c.start && currentSec <= c.end);
      setActiveCueText(match ? match.text : "");
    };

    const interval = setInterval(updateCue, 500);
    return () => clearInterval(interval);
  }, [currentCues, playoutState?.playout_position_ms]);

  const currentPlayingFileRef = useRef<string | null>(null);

  // Sync transcoding playout or direct playout
  useEffect(() => {
    const activeFilePath = activeEntry?.file_path;
    if (activeFilePath) {
      if (!isWebCompatible) {
        if (currentPlayingFileRef.current === activeFilePath && hlsSrc) {
          return;
        }
        currentPlayingFileRef.current = activeFilePath;
        const targetSec = playoutState?.playout_position_ms ? playoutState.playout_position_ms / 1000 : 0;
        invoke<string>("play_in_vlc", {
          filePath: activeFilePath,
          startTimeSec: targetSec
        })
        .then(() => {
          setHlsSrc(`http://127.0.0.1:8098/hls/stream.m3u8?t=${Date.now()}`);
        })
        .catch((err) => {
          console.warn("VLC launch failed inside TV Client, falling back to direct playout:", err);
          setHlsSrc("");
        });
      } else {
        currentPlayingFileRef.current = null;
        setHlsSrc("");
      }
    } else {
      currentPlayingFileRef.current = null;
      setHlsSrc("");
    }
  }, [activeEntry?.file_path, isWebCompatible]);

  // Native WebKit HLS Playout Effect for TV Client
  const tvHlsVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!hlsSrc || isWebCompatible) return;
    const targetVideo = tvHlsVideoRef.current || videoRef.current;
    if (targetVideo) {
      targetVideo.play().catch(err => console.warn("Native HLS play call error:", err));
    }
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
                console.warn("Native WebKit video playout failed for file. Automatic failover to VLC HLS proxy stream...");
                setForceVlcMode(true);
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
              controls
              playsInline
              crossOrigin="anonymous"
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

          {/* ON-SCREEN SUBTITLE OVERLAY */}
          {activeCueText && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-black/90 text-yellow-300 font-sans font-extrabold text-lg px-6 py-2 rounded-lg border border-yellow-500/40 shadow-2xl backdrop-blur-md pointer-events-none z-20 max-w-[85%] text-center leading-relaxed">
              {activeCueText}
            </div>
          )}

          {/* TV CLIENT CONTROLS OVERLAY (Shown on mouse hover) */}
          <div className={`absolute top-4 right-4 flex items-center space-x-3 transition-opacity duration-300 z-30 font-mono ${showControls || showAudioMenu || showSubMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <button
              onClick={() => {
                if (activeEntry?.file_path) {
                  invoke("open_in_vlc_app", { filePath: activeEntry.file_path }).catch(err => console.error(err));
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500 text-xs text-cyan-300 hover:text-black border border-cyan-500/40 rounded-lg shadow-xl backdrop-blur-md transition-all font-mono font-bold cursor-pointer"
              title="Open stream natively in VLC Player app"
            >
              <PlayCircle size={14} />
              <span>OPEN IN NATIVE VLC APP</span>
            </button>
            {/* Audio Track Selector */}
            <div className="relative">
              <button
                onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-black/80 hover:bg-black text-xs text-white border border-gray-700 hover:border-cyan-400 rounded-lg shadow-xl backdrop-blur-md transition-all"
                title="Audio Language Selection"
              >
                <Globe size={14} className="text-cyan-400" />
                <span className="text-xs font-bold">{selectedAudioTrack}</span>
                <ChevronDown size={12} />
              </button>

              {showAudioMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl z-40 py-1 font-sans text-xs">
                  <div className="px-3 py-1 text-[10px] font-bold text-gray-400 border-b border-gray-800 uppercase">Audio Track</div>
                  {availableAudioTracks.map((trk) => (
                    <button
                      key={trk}
                      onClick={() => handleAudioTrackSelect(trk)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors ${
                        selectedAudioTrack === trk ? "text-cyan-400 font-bold" : "text-gray-200"
                      }`}
                    >
                      <span>{trk}</span>
                      {selectedAudioTrack === trk && <Check size={14} className="text-cyan-400" />}
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
                <span className="text-xs font-bold">
                  {selectedSubtitleId === "off"
                    ? "Subtitles: Off"
                    : subtitles.find(s => s.id === selectedSubtitleId)?.language.toUpperCase() || "Subtitles"}
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
                      <span>{sub.language.toUpperCase()} ({sub.subtitle_type.toUpperCase()})</span>
                      {selectedSubtitleId === sub.id && <Check size={14} className="text-cyan-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
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
