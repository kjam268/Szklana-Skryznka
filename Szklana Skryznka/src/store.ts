import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// --- TYPES ---
export interface MediaItem {
  id: string;
  title: string;
  original_title?: string;
  media_type: string;
  year?: number;
  runtime: number; // in seconds
  synopsis?: string;
  rating?: number;
  poster_path?: string;
  backdrop_path?: string;
  director_id?: string;
  created_at: string;
  updated_at: string;
  rt_score?: string;
  imdb_score?: string;
  imdb_id?: string;
}

export interface MediaFile {
  id: string;
  media_item_id: string;
  file_path: string;
  file_size: number;
  checksum?: string;
  video_codec?: string;
  audio_codec?: string;
  resolution?: string;
  duration: number;
  quality_score?: number;
  quality_score_done?: number;
  video_bitrate?: number;
  frame_rate?: number;
  audio_channels?: number;
  audio_language?: string;
  audio_tracks?: string;
  embedded_subtitles?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  video_profile?: string;
  video_level?: number;
  audio_sample_rate?: string;
  ebur128_loudness?: number;
  vmaf_score?: number;
}

export interface Subtitle {
  id: string;
  media_item_id: string;
  language: string;
  subtitle_type: string;
  file_path: string;
  is_default: number;
}

export interface MediaItemDetails {
  item: MediaItem;
  files: MediaFile[];
  subtitles: Subtitle[];
  genres: string[];
  tags: string[];
  actors: string[];
  directors: string[];
}

export interface Schedule {
  id: string;
  channel_id: string;
  name: string;
  start_time: string;
  end_time: string;
}

export interface ScheduleEntry {
  id: string;
  schedule_id: string;
  media_item_id: string;
  start_time: string;
  end_time: string;
  is_locked: number;
  explanation?: string;
}

export interface ScheduleEntryDetails {
  id: string;
  schedule_id: string;
  media_item_id: string;
  start_time: string;
  end_time: string;
  is_locked: number;
  explanation?: string;
  item_title: string;
  media_type: string;
  duration: number;
  poster_path?: string;
  backdrop_path?: string;
  file_path?: string;
}

export interface PlayoutState {
  channel_id: string;
  current_time: string;
  active_entry: ScheduleEntryDetails | null;
  next_entry: ScheduleEntryDetails | null;
  previous_entry: ScheduleEntryDetails | null;
  playout_position_ms: number;
}

export interface DiagnosticsReport {
  missing_posters_count: number;
  missing_backdrops_count: number;
  missing_synopsis_count: number;
  missing_english_subs_count: number;
  missing_french_subs_count: number;
  duplicate_files: string[];
  duplicate_metadata: string[];
}

export interface Channel {
  id: string;
  name: string;
  logo_path?: string;
  profile_name?: string;
}

// --- LIBRARIES STORE ---
interface LibraryStore {
  items: MediaItemDetails[];
  isLoading: boolean;
  isScanning: boolean;
  scanProgress: number;
  scanLogs: string;
  searchQuery: string;
  selectedType: string;
  fetchItems: (silent?: boolean) => Promise<void>;
  scanLibrary: (path: string) => Promise<string>;
  saveMetadata: (details: MediaItemDetails) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedType: (type: string) => void;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  items: [],
  isLoading: false,
  isScanning: false,
  scanProgress: 0,
  scanLogs: "",
  searchQuery: "",
  selectedType: "All",
  fetchItems: async (silent = false) => {
    if (!silent) {
      set({ isLoading: true });
    }
    try {
      const items = await invoke<MediaItemDetails[]>("get_media");
      set({ items, isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },
  scanLibrary: async (path: string) => {
    set({ isScanning: true, scanProgress: 0, scanLogs: `Initializing scan for directory: ${path}...` });
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenProgress = listen<number>("scan-progress", (event) => {
        set({ scanProgress: event.payload });
      });
      const unlistenFile = listen<string>("scan-file", (event) => {
        set({ scanLogs: `Importing: ${event.payload}` });
      });

      const logs = await invoke<string>("scan_library", { path });
      
      unlistenProgress.then((f) => f());
      unlistenFile.then((f) => f());
      set({ isScanning: false, scanProgress: 100, scanLogs: logs });
      await get().fetchItems();
      return logs;
    } catch (e: any) {
      set({ isScanning: false, scanProgress: 0, scanLogs: `Scan failed: ${e}` });
      throw e;
    }
  },
  saveMetadata: async (details: MediaItemDetails) => {
    await invoke("save_media", { details });
    await get().fetchItems(true);
  },
  deleteItem: async (id: string) => {
    await invoke("delete_media", { id });
    await get().fetchItems();
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedType: (type) => set({ selectedType: type }),
}));

// --- SCHEDULE STORE ---
interface ScheduleStore {
  entries: ScheduleEntryDetails[];
  selectedProfile: string;
  selectedPolicy: string;
  isLoading: boolean;
  setSelectedProfile: (profile: string) => void;
  setSelectedPolicy: (policy: string) => void;
  fetchEntries: (channelId: string, startIso: string, endIso: string) => Promise<void>;
  generateSchedule: (channelId: string, startIso: string, endIso: string) => Promise<void>;
  addEntry: (channelId: string, itemId: string, startIso: string, locked: boolean, explanation: string) => Promise<void>;
  updateEntry: (entryId: string, startIso: string, endIso: string, locked: boolean) => Promise<void>;
}

export const useScheduleStore = create<ScheduleStore>((set) => ({
  entries: [],
  selectedProfile: "Mixed Family Channel",
  selectedPolicy: "Balanced",
  isLoading: false,
  setSelectedProfile: (profile) => set({ selectedProfile: profile }),
  setSelectedPolicy: (policy) => set({ selectedPolicy: policy }),
  fetchEntries: async (channelId, startIso, endIso) => {
    set({ isLoading: true });
    try {
      const entries = await invoke<ScheduleEntryDetails[]>("get_schedule_entries", { 
        channelId, 
        startTimeIso: startIso, 
        endTimeIso: endIso 
      });
      set({ entries, isLoading: false });
    } catch (e) {
      console.error("Failed to fetch schedule entries:", e);
      set({ entries: [], isLoading: false });
    }
  },
  generateSchedule: async (channelId, startIso, endIso) => {
    set({ isLoading: true });
    try {
      const profile = useScheduleStore.getState().selectedProfile;
      const policy = useScheduleStore.getState().selectedPolicy;
      await invoke("start_channel", { 
        channelId, 
        profileName: profile, 
        startTimeIso: startIso, 
        endTimeIso: endIso, 
        policy 
      });
      set({ isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
      throw e;
    }
  },
  addEntry: async (channelId, itemId, startIso, locked, explanation) => {
    await invoke("create_schedule", { 
      channelId, 
      mediaItemId: itemId, 
      startTimeIso: startIso, 
      isLocked: locked, 
      explanation 
    });
  },
  updateEntry: async (entryId, startIso, endIso, locked) => {
    await invoke("update_schedule", { 
      entryId, 
      startTimeIso: startIso, 
      endTimeIso: endIso, 
      isLocked: locked 
    });
  },
}));

// --- PLAYER STORE ---
interface PlayerStore {
  isPlaying: boolean;
  playoutPosition: number; // ms
  isFullscreen: boolean;
  volume: number;
  setPlaying: (playing: boolean) => void;
  setPlayoutPosition: (pos: number) => void;
  setFullscreen: (fs: boolean) => void;
  setVolume: (v: number) => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  isPlaying: false,
  playoutPosition: 0,
  isFullscreen: false,
  volume: 0.8,
  setPlaying: (playing) => set({ isPlaying: playing }),
  setPlayoutPosition: (pos) => set({ playoutPosition: pos }),
  setFullscreen: (fs) => set({ isFullscreen: fs }),
  setVolume: (v) => set({ volume: v }),
}));

// --- SETTINGS STORE ---
interface SettingsStore {
  scanDirectories: string[];
  activeChannelId: string;
  addDirectory: (path: string) => void;
  removeDirectory: (path: string) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  scanDirectories: [],
  activeChannelId: "chan_default",
  addDirectory: (path) => set((state) => {
    if (state.scanDirectories.includes(path)) return state;
    return { scanDirectories: [...state.scanDirectories, path] };
  }),
  removeDirectory: (path) => set((state) => ({
    scanDirectories: state.scanDirectories.filter((d) => d !== path),
  })),
}));

// --- CHANNEL STORE ---
interface ChannelStore {
  channels: Channel[];
  playoutState: PlayoutState | null;
  isLoading: boolean;
  fetchChannels: () => Promise<void>;
  fetchPlayoutState: (channelId: string, currentIso: string) => Promise<void>;
}

export const useChannelStore = create<ChannelStore>((set) => ({
  channels: [],
  playoutState: null,
  isLoading: false,
  fetchChannels: async () => {
    try {
      const channels = await invoke<Channel[]>("get_channel_status");
      set({ channels });
    } catch (e) {
      console.error(e);
    }
  },
  fetchPlayoutState: async (channelId, currentIso) => {
    set({ isLoading: true });
    try {
      const playoutState = await invoke<PlayoutState>("get_current_program", { channelId, currentTimeIso: currentIso });
      set({ playoutState, isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },
}));

// --- DIAGNOSTICS STORE ---
interface DiagnosticsStore {
  report: DiagnosticsReport | null;
  isLoading: boolean;
  fetchReport: () => Promise<void>;
}

export const useDiagnosticsStore = create<DiagnosticsStore>((set) => ({
  report: null,
  isLoading: false,
  fetchReport: async () => {
    set({ isLoading: true });
    try {
      const report = await invoke<DiagnosticsReport>("run_diagnostics");
      set({ report, isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },
}));

// --- NOTIFICATION STORE (TOASTS) ---
export interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "error";
}

interface NotificationStore {
  toasts: Toast[];
  showToast: (message: string, type?: "info" | "success" | "error") => void;
  dismissToast: (id: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  toasts: [],
  showToast: (message, type = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
    // Auto dismiss after 4 seconds
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  },
  dismissToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
}));

