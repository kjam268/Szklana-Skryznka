import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings2, Key, Radio, BookOpen, Info, Check, X,
  RefreshCw, Trash2, ExternalLink, Save, AlertTriangle
} from "lucide-react";
import { useNotificationStore } from "../store";

type SettingsTab = "apis" | "broadcast" | "library" | "about";
interface AppSettings {
  tmdb_api_key: string; omdb_api_key: string; anilist_api_key: string;
  hls_quality: string; default_subtitle_lang: string; default_audio_lang: string;
}
const QUALITY_PRESETS = [
  { id: "low",          label: "Low",         desc: "720p · 1.5 Mbps — best for weak hardware" },
  { id: "standard",    label: "Standard",     desc: "1080p · 3 Mbps — default, balanced" },
  { id: "high",        label: "High",         desc: "1080p · 6 Mbps — best quality, more CPU" },
  { id: "passthrough", label: "Passthrough",  desc: "No transcode — direct HLS mux (fastest)" },
];
const COMMON_LANGS = ["en","fr","de","es","it","pl","pt","ja","ko","zh","ar","ru"];

export const Settings: React.FC = () => {
  const showToast = useNotificationStore(s => s.showToast);
  const [activeTab, setActiveTab] = useState<SettingsTab>("apis");
  const [settings, setSettings] = useState<AppSettings>({
    tmdb_api_key: "", omdb_api_key: "", anilist_api_key: "",
    hls_quality: "standard", default_subtitle_lang: "en", default_audio_lang: "en",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [tmdbTest, setTmdbTest] = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [watchedPaths, setWatchedPaths] = useState<string[]>([]);
  const [isPurging, setIsPurging] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await invoke<Record<string, string>>("get_all_settings");
      setSettings({
        tmdb_api_key: all["tmdb_api_key"] ?? "",
        omdb_api_key: all["omdb_api_key"] ?? "",
        anilist_api_key: all["anilist_api_key"] ?? "",
        hls_quality: all["hls_quality"] ?? "standard",
        default_subtitle_lang: all["default_subtitle_lang"] ?? "en",
        default_audio_lang: all["default_audio_lang"] ?? "en",
      });
      const paths = await invoke<string[]>("get_watched_paths");
      setWatchedPaths(paths);
    } catch (e) { console.error("Settings load failed:", e); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const saveSetting = async (key: keyof AppSettings, value: string) => {
    setIsSaving(s => ({ ...s, [key]: true }));
    try {
      await invoke("set_setting", { key, value });
      setSettings(s => ({ ...s, [key]: value }));
      showToast("Setting saved", "success");
    } catch (e) { showToast(`Save failed: ${e}`, "error"); }
    finally { setIsSaving(s => ({ ...s, [key]: false })); }
  };

  const testTmdb = async () => {
    if (!settings.tmdb_api_key) return;
    setTmdbTest("testing");
    try {
      const r = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${settings.tmdb_api_key}`);
      setTmdbTest(r.ok ? "ok" : "fail");
    } catch { setTmdbTest("fail"); }
  };

  const removePath = async (path: string) => {
    try {
      await invoke("remove_watched_path", { path });
      setWatchedPaths(p => p.filter(x => x !== path));
      showToast("Directory removed", "success");
    } catch (e) { showToast(`Failed: ${e}`, "error"); }
  };

  const purgeDatabase = async () => {
    if (!window.confirm("Delete ALL library data? This cannot be undone.")) return;
    setIsPurging(true);
    try {
      await invoke("purge_database");
      showToast("Database purged — restart recommended", "success");
    } catch (e) { showToast(`Purge failed: ${e}`, "error"); }
    finally { setIsPurging(false); }
  };

  const tabs = [
    { id: "apis" as SettingsTab,      label: "METADATA APIS", icon: <Key size={12} /> },
    { id: "broadcast" as SettingsTab, label: "BROADCAST",     icon: <Radio size={12} /> },
    { id: "library" as SettingsTab,   label: "LIBRARY",       icon: <BookOpen size={12} /> },
    { id: "about" as SettingsTab,     label: "ABOUT",         icon: <Info size={12} /> },
  ];

  return (
    <div className="flex-1 h-screen flex flex-col p-6 bg-background text-gray-200 font-mono overflow-hidden">
      <div className="shrink-0 border-b border-gray-800 pb-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
              <Settings2 size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-widest text-accent uppercase">SETTINGS</h1>
              <p className="text-[10px] text-gray-500">Station configuration &amp; integrations</p>
            </div>
          </div>
          <button onClick={loadSettings} disabled={isLoading}
            className="flex items-center space-x-1 text-[10px] font-bold text-gray-400 hover:text-accent border border-gray-800 hover:border-accent/40 rounded px-2 py-1 transition-all disabled:opacity-50">
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} /><span>RELOAD</span>
          </button>
        </div>
        <div className="flex mt-4 bg-gray-900 border border-gray-800 rounded p-0.5 w-fit gap-0.5">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-[10px] font-bold transition-all ${activeTab === tab.id ? "bg-accent text-background shadow" : "text-gray-400 hover:text-gray-200"}`}>
              {tab.icon}<span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-xs text-gray-500">
            <RefreshCw size={14} className="animate-spin mr-2 text-accent" /> Loading settings…
          </div>
        ) : (
          <>
            {activeTab === "apis" && (
              <div className="space-y-8 max-w-2xl">
                <ApiKeyRow label="TMDb API Key" desc="The Movie Database — poster art, synopsis, director & cast"
                  docsUrl="https://www.themoviedb.org/settings/api"
                  value={settings.tmdb_api_key} onChange={v => setSettings(s => ({ ...s, tmdb_api_key: v }))}
                  onSave={() => saveSetting("tmdb_api_key", settings.tmdb_api_key)} saving={!!isSaving["tmdb_api_key"]}
                  extra={
                    <button onClick={testTmdb} disabled={tmdbTest === "testing" || !settings.tmdb_api_key}
                      className="shrink-0 px-3 py-2 text-[10px] font-bold bg-gray-900 border border-gray-700 hover:border-gray-500 rounded transition-all disabled:opacity-40">
                      {tmdbTest === "testing" ? <RefreshCw size={10} className="animate-spin" />
                       : tmdbTest === "ok" ? <Check size={10} className="text-emerald-400" />
                       : tmdbTest === "fail" ? <X size={10} className="text-rose-400" /> : "TEST"}
                    </button>
                  } />
                <ApiKeyRow label="OMDb API Key" desc="Open Movie Database — IMDB ratings & additional metadata"
                  docsUrl="https://www.omdbapi.com/apikey.aspx"
                  value={settings.omdb_api_key} onChange={v => setSettings(s => ({ ...s, omdb_api_key: v }))}
                  onSave={() => saveSetting("omdb_api_key", settings.omdb_api_key)} saving={!!isSaving["omdb_api_key"]} />
                <ApiKeyRow label="AniList API Key" desc="Anime metadata, season/episode data, artwork"
                  docsUrl="https://anilist.co/settings/developer"
                  value={settings.anilist_api_key} onChange={v => setSettings(s => ({ ...s, anilist_api_key: v }))}
                  onSave={() => saveSetting("anilist_api_key", settings.anilist_api_key)} saving={!!isSaving["anilist_api_key"]} />
              </div>
            )}

            {activeTab === "broadcast" && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">HLS TRANSCODE QUALITY</p>
                  <div className="grid grid-cols-2 gap-3">
                    {QUALITY_PRESETS.map(p => (
                      <button key={p.id} onClick={() => saveSetting("hls_quality", p.id)}
                        className={`p-3 rounded-lg border text-left transition-all ${settings.hls_quality === p.id ? "bg-accent/10 border-accent/50 text-accent" : "bg-gray-900/50 border-gray-800 text-gray-400 hover:border-gray-600"}`}>
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span>{p.label}</span>
                          {settings.hls_quality === p.id && <Check size={12} className="text-accent" />}
                        </div>
                        <div className="text-[9px] mt-0.5 opacity-70">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {(["default_subtitle_lang","default_audio_lang"] as (keyof AppSettings)[]).map(key => (
                    <div key={key}>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        {key === "default_subtitle_lang" ? "Default Subtitle Language" : "Default Audio Language"}
                      </p>
                      <select value={settings[key]}
                        onChange={e => { const v = e.target.value; setSettings(s => ({ ...s, [key]: v })); saveSetting(key, v); }}
                        className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-accent/50">
                        {COMMON_LANGS.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "library" && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">SCANNED DIRECTORIES</p>
                    <span className="text-[9px] text-gray-600">{watchedPaths.length} path(s) watched</span>
                  </div>
                  {watchedPaths.length === 0 ? (
                    <div className="text-xs text-gray-600 py-6 text-center border border-gray-800 rounded-lg">
                      No directories configured. Add folders from the Library page.
                    </div>
                  ) : watchedPaths.map(path => (
                    <div key={path} className="flex items-center justify-between p-2.5 mb-2 bg-gray-900 border border-gray-800 rounded-lg">
                      <span className="text-[10px] text-gray-300 font-mono truncate flex-1 mr-2">{path}</span>
                      <button onClick={() => removePath(path)} className="shrink-0 text-rose-500/60 hover:text-rose-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-4">
                  <div className="flex items-start space-x-2 mb-3">
                    <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[10px] font-bold text-rose-400">DANGER ZONE</div>
                      <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">Permanently deletes all library entries, schedules, and history. Cannot be undone.</div>
                    </div>
                  </div>
                  <button onClick={purgeDatabase} disabled={isPurging}
                    className="flex items-center space-x-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-[10px] font-bold px-4 py-2 rounded-lg transition-colors">
                    {isPurging ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    <span>{isPurging ? "PURGING…" : "PURGE DATABASE"}</span>
                  </button>
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <div className="max-w-xl space-y-4">
                <div className="bg-panel border border-gray-800 rounded-lg p-4 space-y-3">
                  {[["Application","Szklana Skryznka"],["Version","v0.9.0 (Phase 2)"],["Framework","Tauri 2 · Rust · React"],
                    ["Database","SQLite (sqlx)"],["Streaming","FFmpeg HLS + WebKit Playout"],
                    ["Subtitles","OpenSubtitles.org API"],["Metadata","TMDb · OMDb · AniList"]].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500 font-bold">{label}</span>
                      <span className="text-gray-300 font-mono">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-gray-600 text-center">Personal broadcast station — local-first, self-hosted, always-on.</p>
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-800 text-[10px] text-gray-500 shrink-0">SETTINGS STORAGE: SQLITE LOCAL DB</div>
    </div>
  );
};

interface ApiKeyRowProps {
  label: string; desc: string; docsUrl: string;
  value: string; onChange: (v: string) => void;
  onSave: () => void; saving: boolean; extra?: React.ReactNode;
}
const ApiKeyRow: React.FC<ApiKeyRowProps> = ({ label, desc, docsUrl, value, onChange, onSave, saving, extra }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">{label}</p>
      <a href={docsUrl} target="_blank" rel="noreferrer" className="flex items-center space-x-1 text-[9px] text-accent/60 hover:text-accent transition-colors">
        <ExternalLink size={9} /><span>GET KEY</span>
      </a>
    </div>
    <p className="text-[9px] text-gray-600 leading-relaxed">{desc}</p>
    <div className="flex items-center space-x-2">
      <input type="password" value={value} onChange={e => onChange(e.target.value)} placeholder="Paste API key here…"
        className="flex-1 bg-gray-950 border border-gray-800 rounded px-3 py-2 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-accent/50 transition-colors" />
      {extra}
      <button onClick={onSave} disabled={saving}
        className="shrink-0 flex items-center space-x-1 px-3 py-2 text-[10px] font-bold rounded border bg-accent/10 border-accent/30 text-accent hover:bg-accent hover:text-background transition-all disabled:opacity-50">
        {saving ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
        <span>SAVE</span>
      </button>
    </div>
  </div>
);
