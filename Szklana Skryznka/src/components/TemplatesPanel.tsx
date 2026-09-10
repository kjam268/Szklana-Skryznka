import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Play, RefreshCw, Layout, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useNotificationStore } from "../store";

interface TemplateEntry {
  id: string;
  offsetSeconds: number;
  durationSeconds: number;
  mediaTypeFilter?: string;
  genreFilter?: string;
  isFiller: boolean;
}

interface Template {
  id: string;
  name: string;
  description?: string;
  entryCount: number;
  entries: TemplateEntry[];
}

interface NewEntry {
  offsetHH: string; offsetMM: string;
  durationHH: string; durationMM: string;
  mediaTypeFilter: string; genreFilter: string;
}

interface Props {
  channelId: string;
  selectedDayIso: string;
  onApplied: () => void;
}

const fmtOffset = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
};
const fmtDur = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const TemplatesPanel: React.FC<Props> = ({ channelId, selectedDayIso, onApplied }) => {
  const showToast = useNotificationStore(s => s.showToast);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newEntries, setNewEntries] = useState<NewEntry[]>([
    { offsetHH: "19", offsetMM: "00", durationHH: "2", durationMM: "00", mediaTypeFilter: "Movie", genreFilter: "" }
  ]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<Template[]>("get_schedule_templates");
      setTemplates(list);
    } catch (e) { showToast(`Failed to load templates: ${e}`, "error"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const applyTemplate = async (template: Template) => {
    setApplying(template.id);
    try {
      const msg = await invoke<string>("apply_template", {
        channelId, templateId: template.id, startTimeIso: selectedDayIso
      });
      showToast(msg, "success");
      onApplied();
    } catch (e) { showToast(`Apply failed: ${e}`, "error"); }
    finally { setApplying(null); }
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm("Delete this template?")) return;
    setDeleting(id);
    try {
      await invoke("delete_schedule_template", { templateId: id });
      setTemplates(t => t.filter(x => x.id !== id));
      showToast("Template deleted", "success");
    } catch (e) { showToast(`Delete failed: ${e}`, "error"); }
    finally { setDeleting(null); }
  };

  const addEntry = () => setNewEntries(e => [
    ...e,
    { offsetHH: "00", offsetMM: "00", durationHH: "2", durationMM: "00", mediaTypeFilter: "Movie", genreFilter: "" }
  ]);

  const removeEntry = (i: number) => setNewEntries(e => e.filter((_, idx) => idx !== i));

  const createTemplate = async () => {
    if (!newName.trim()) { showToast("Name is required", "error"); return; }
    setCreating(true);
    try {
      const entries = newEntries.map(e => ({
        offset_seconds: (parseInt(e.offsetHH) * 3600) + (parseInt(e.offsetMM) * 60),
        duration_seconds: (parseInt(e.durationHH) * 3600) + (parseInt(e.durationMM) * 60),
        media_type_filter: e.mediaTypeFilter || null,
        genre_filter: e.genreFilter || null,
        is_filler: false,
      }));
      await invoke("create_schedule_template", { name: newName.trim(), description: newDesc || null, entries });
      showToast("Template created", "success");
      setShowNew(false); setNewName(""); setNewDesc("");
      setNewEntries([{ offsetHH: "19", offsetMM: "00", durationHH: "2", durationMM: "00", mediaTypeFilter: "Movie", genreFilter: "" }]);
      await load();
    } catch (e) { showToast(`Create failed: ${e}`, "error"); }
    finally { setCreating(false); }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800 w-72 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
        <div className="flex items-center space-x-2">
          <Layout size={13} className="text-accent" />
          <span className="text-[10px] font-bold text-accent uppercase tracking-widest">Templates</span>
        </div>
        <div className="flex items-center space-x-1">
          <button onClick={load} className="text-gray-500 hover:text-accent transition-colors p-1 rounded">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setShowNew(s => !s)}
            className="flex items-center space-x-1 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-[9px] font-bold px-2 py-1 rounded transition-all">
            <Plus size={10} /><span>NEW</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* New template form */}
        {showNew && (
          <div className="bg-gray-900 border border-accent/20 rounded-lg p-3 space-y-3">
            <p className="text-[9px] font-bold text-accent uppercase tracking-widest">NEW TEMPLATE</p>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Template name…"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-accent/50" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-accent/50" />

            <div className="space-y-2">
              <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">TIME BLOCKS</p>
              {newEntries.map((entry, i) => (
                <div key={i} className="bg-gray-950 border border-gray-800 rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-500">Block {i+1}</span>
                    {newEntries.length > 1 && (
                      <button onClick={() => removeEntry(i)} className="text-rose-500/60 hover:text-rose-400 transition-colors"><Trash2 size={10} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <p className="text-[8px] text-gray-600 mb-0.5">START (HH:MM)</p>
                      <div className="flex items-center space-x-1">
                        <input type="number" min="0" max="23" value={entry.offsetHH}
                          onChange={e => setNewEntries(entries => entries.map((en, idx) => idx===i ? {...en, offsetHH: e.target.value} : en))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[10px] font-mono text-gray-300 focus:outline-none" />
                        <span className="text-gray-600 text-[10px]">:</span>
                        <input type="number" min="0" max="59" value={entry.offsetMM}
                          onChange={e => setNewEntries(entries => entries.map((en, idx) => idx===i ? {...en, offsetMM: e.target.value} : en))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[10px] font-mono text-gray-300 focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[8px] text-gray-600 mb-0.5">DURATION (HH:MM)</p>
                      <div className="flex items-center space-x-1">
                        <input type="number" min="0" max="23" value={entry.durationHH}
                          onChange={e => setNewEntries(entries => entries.map((en, idx) => idx===i ? {...en, durationHH: e.target.value} : en))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[10px] font-mono text-gray-300 focus:outline-none" />
                        <span className="text-gray-600 text-[10px]">:</span>
                        <input type="number" min="0" max="59" value={entry.durationMM}
                          onChange={e => setNewEntries(entries => entries.map((en, idx) => idx===i ? {...en, durationMM: e.target.value} : en))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[10px] font-mono text-gray-300 focus:outline-none" />
                      </div>
                    </div>
                  </div>
                  <select value={entry.mediaTypeFilter}
                    onChange={e => setNewEntries(entries => entries.map((en, idx) => idx===i ? {...en, mediaTypeFilter: e.target.value} : en))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] font-mono text-gray-300 focus:outline-none">
                    <option value="">Any type</option>
                    <option value="Movie">Movie</option>
                    <option value="Episode">Episode</option>
                    <option value="Documentary">Documentary</option>
                  </select>
                </div>
              ))}
              <button onClick={addEntry} className="w-full flex items-center justify-center space-x-1 text-[9px] font-bold text-gray-500 hover:text-accent border border-dashed border-gray-700 hover:border-accent/40 rounded py-1.5 transition-all">
                <Plus size={10} /><span>ADD BLOCK</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button onClick={() => setShowNew(false)} className="flex-1 text-[10px] font-bold text-gray-500 hover:text-gray-300 border border-gray-700 rounded py-1.5 transition-colors">
                CANCEL
              </button>
              <button onClick={createTemplate} disabled={creating}
                className="flex-1 flex items-center justify-center space-x-1 text-[10px] font-bold bg-accent text-background hover:bg-accent/90 rounded py-1.5 transition-colors disabled:opacity-50">
                {creating ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
                <span>CREATE</span>
              </button>
            </div>
          </div>
        )}

        {/* Template list */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-600 text-xs">
            <RefreshCw size={12} className="animate-spin mr-2" /> Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-[10px]">
            No templates yet.<br />Create one to apply programming blocks.
          </div>
        ) : templates.map(tmpl => (
          <div key={tmpl.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex-1 min-w-0 mr-2">
                <p className="text-[11px] font-bold text-gray-200 truncate">{tmpl.name}</p>
                <p className="text-[9px] text-gray-500">{tmpl.entryCount} block(s)</p>
              </div>
              <div className="flex items-center space-x-1 shrink-0">
                <button onClick={() => setExpanded(e => e === tmpl.id ? null : tmpl.id)}
                  className="text-gray-500 hover:text-gray-300 transition-colors p-1">
                  {expanded === tmpl.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                <button onClick={() => applyTemplate(tmpl)} disabled={applying === tmpl.id}
                  className="flex items-center space-x-1 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-[9px] font-bold px-2 py-1 rounded transition-all disabled:opacity-50">
                  {applying === tmpl.id ? <RefreshCw size={10} className="animate-spin" /> : <Play size={10} />}
                  <span>APPLY</span>
                </button>
                <button onClick={() => deleteTemplate(tmpl.id)} disabled={deleting === tmpl.id}
                  className="text-rose-500/50 hover:text-rose-400 transition-colors p-1">
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            {expanded === tmpl.id && (
              <div className="border-t border-gray-800 px-2.5 py-2 space-y-1">
                {tmpl.description && (
                  <p className="text-[9px] text-gray-500 mb-1.5 italic">{tmpl.description}</p>
                )}
                {tmpl.entries.map((e) => (
                  <div key={e.id} className="flex items-center space-x-2 text-[9px] text-gray-400">
                    <Clock size={9} className="text-accent/60 shrink-0" />
                    <span className="font-mono text-accent/80">{fmtOffset(e.offsetSeconds)}</span>
                    <span>→</span>
                    <span>{fmtDur(e.durationSeconds)}</span>
                    {e.mediaTypeFilter && <span className="bg-gray-800 px-1 rounded">{e.mediaTypeFilter}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-800">
        <p className="text-[9px] text-gray-600">APPLYING TO: {new Date(selectedDayIso).toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" }).toUpperCase()}</p>
      </div>
    </div>
  );
};
