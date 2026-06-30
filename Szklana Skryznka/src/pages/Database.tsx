import React, { useEffect, useState, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { useLibraryStore, MediaItemDetails } from "../store";
import { Database, Download, Upload } from "lucide-react";

// Register all community modules for AG Grid
ModuleRegistry.registerModules([AllCommunityModule]);

// CSS imports for AG Grid themes (bundled internally or loaded)
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

export const DatabaseViewer: React.FC = () => {
  const { items, fetchItems, saveMetadata } = useLibraryStore();
  const [rowData, setRowData] = useState<any[]>([]);
  const gridRef = useRef<AgGridReact>(null);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    // Map MediaItemDetails to flat rows for AG Grid
    const mapped = items.map((details) => {
      const firstFile = details.files[0] || {};
      return {
        id: details.item.id,
        title: details.item.title,
        original_title: details.item.original_title || "",
        media_type: details.item.media_type,
        year: details.item.year || 2026,
        runtime: details.item.runtime,
        imdb_score: details.item.imdb_score || "N/A",
        rt_score: details.item.rt_score || "N/A",
        poster_path: details.item.poster_path || "N/A",
        genres: details.genres.join(", "),
        tags: details.tags.join(", "),
        checksum: firstFile.checksum || "N/A",
        video_codec: firstFile.video_codec || "N/A",
        audio_codec: firstFile.audio_codec || "N/A",
        resolution: firstFile.resolution || "N/A",
        duration: firstFile.duration || 0,
        video_bitrate: firstFile.video_bitrate || 0,
        frame_rate: firstFile.frame_rate || 0.0,
        audio_channels: firstFile.audio_channels || 0,
        audio_language: firstFile.audio_language || "N/A",
        audio_tracks: firstFile.audio_tracks || "N/A",
        embedded_subtitles: firstFile.embedded_subtitles || "N/A",
        color_space: firstFile.color_space || "N/A",
        color_transfer: firstFile.color_transfer || "N/A",
        color_primaries: firstFile.color_primaries || "N/A",
        video_profile: firstFile.video_profile || "N/A",
        video_level: firstFile.video_level || 0,
        audio_sample_rate: firstFile.audio_sample_rate || "N/A",
        ebur128_loudness: firstFile.ebur128_loudness !== undefined && firstFile.ebur128_loudness !== null
          ? `${firstFile.ebur128_loudness.toFixed(2)} LUFS`
          : "N/A",
        vmaf_score: firstFile.vmaf_score !== undefined && firstFile.vmaf_score !== null
          ? firstFile.vmaf_score.toFixed(1)
          : "N/A",
        quality_score: firstFile.quality_score !== undefined && firstFile.quality_score !== null
          ? `${firstFile.quality_score.toFixed(1)} / 100`
          : "N/A",
      };
    });
    setRowData(mapped);
  }, [items]);

  const columnDefs = [
    { field: "id", headerName: "ID", width: 100, editable: false },
    { field: "title", headerName: "TITLE", width: 150, editable: true },
    { field: "original_title", headerName: "ORIGINAL TITLE", width: 140, editable: true },
    { field: "media_type", headerName: "TYPE", width: 90, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: {
        values: ["Movie", "TVShow", "Episode", "Anime", "Documentary", "Educational", "Bumper", "StationID", "Trailer", "Commercial"]
      } 
    },
    { field: "year", headerName: "YEAR", width: 70, editable: true },
    { field: "runtime", headerName: "TMDb RUNTIME (MIN)", width: 140, editable: true },
    { field: "imdb_score", headerName: "IMDb SCORE", width: 100, editable: true },
    { field: "rt_score", headerName: "RT SCORE", width: 100, editable: true },
    { field: "genres", headerName: "GENRES", width: 130, editable: true },
    { field: "tags", headerName: "TAGS", width: 130, editable: true },
    { field: "poster_path", headerName: "POSTER PATH/URL", width: 180, editable: true },
    { field: "checksum", headerName: "FILE CHECKSUM", width: 140, editable: false },
    { field: "video_codec", headerName: "VIDEO CODEC", width: 110, editable: false },
    { field: "audio_codec", headerName: "AUDIO CODEC", width: 110, editable: false },
    { field: "resolution", headerName: "RESOLUTION", width: 110, editable: false },
    { field: "duration", headerName: "DURATION (SEC)", width: 120, editable: false },
    { field: "video_bitrate", headerName: "BITRATE", width: 95, editable: false },
    { field: "frame_rate", headerName: "FRAME RATE", width: 100, editable: false },
    { field: "audio_channels", headerName: "AUDIO CH", width: 90, editable: false },
    { field: "audio_language", headerName: "AUDIO LANG", width: 110, editable: false },
    { field: "audio_tracks", headerName: "AUDIO TRACKS", width: 130, editable: false },
    { field: "embedded_subtitles", headerName: "EMBEDDED SUBS", width: 135, editable: false },
    { field: "color_space", headerName: "COLOR SPACE", width: 115, editable: false },
    { field: "color_transfer", headerName: "COLOR TRNS", width: 110, editable: false },
    { field: "color_primaries", headerName: "COLOR PRIM", width: 110, editable: false },
    { field: "video_profile", headerName: "VIDEO PROF", width: 110, editable: false },
    { field: "video_level", headerName: "VIDEO LVL", width: 95, editable: false },
    { field: "audio_sample_rate", headerName: "SAMPLE RATE", width: 115, editable: false },
    { field: "ebur128_loudness", headerName: "LOUDNESS", width: 110, editable: false },
    { field: "vmaf_score", headerName: "VMAF", width: 80, editable: false },
    { field: "quality_score", headerName: "QUALITY", width: 100, editable: false },
  ];

  // Auto-save edited cell
  const onCellValueChanged = async (event: any) => {
    const data = event.data;
    // Find original detail structure
    const original = items.find((details) => details.item.id === data.id);
    if (!original) return;

    const updated: MediaItemDetails = {
      ...original,
      item: {
        ...original.item,
        title: data.title,
        original_title: data.original_title,
        media_type: data.media_type,
        year: parseInt(data.year),
        runtime: parseInt(data.runtime),
        imdb_score: data.imdb_score === "N/A" ? "" : data.imdb_score,
        rt_score: data.rt_score === "N/A" ? "" : data.rt_score,
        poster_path: data.poster_path === "N/A" ? "" : data.poster_path,
      },
      genres: data.genres.split(",").map((g: string) => g.trim()).filter((g: string) => g !== ""),
      tags: data.tags.split(",").map((t: string) => t.trim()).filter((t: string) => t !== ""),
    };

    try {
      await saveMetadata(updated);
      console.log(`Auto-saved metadata change for item ID: ${data.id}`);
    } catch (err) {
      console.error("Auto-save failed: ", err);
      alert(`Auto-save failed: ${err}`);
      fetchItems(); // revert view
    }
  };

  const handleExportCSV = () => {
    if (gridRef.current) {
      // Manual CSV string construction
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += "ID,Title,Original Title,Media Type,Year,Runtime,Rating,Genres\n";
      
      rowData.forEach((r) => {
        const row = [
          `"${r.id}"`,
          `"${r.title.replace(/"/g, '""')}"`,
          `"${r.original_title.replace(/"/g, '""')}"`,
          `"${r.media_type}"`,
          r.year,
          r.runtime,
          r.rating,
          `"${r.genres.replace(/"/g, '""')}"`
        ].join(",");
        csvContent += row + "\n";
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `szklana_skryznka_metadata_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      // Skip header
      let importedCount = 0;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.replace(/^"|"$/g, "").trim());
        if (parts.length >= 7) {
          // Construct item structures
          const title = parts[1];
          const origTitle = parts[2];
          const mediaType = parts[3];
          const year = parseInt(parts[4]) || 2026;
          const runtime = parseInt(parts[5]) || 300;
          const rating = parseFloat(parts[6]) || 5.0;
          const genres = parts[7] ? parts[7].split(";") : [];

          // Trigger sqlite insert via mock save or custom command
          const details: MediaItemDetails = {
            item: {
              id: `item_${Math.random().toString(36).substr(2, 9)}`,
              title,
              original_title: origTitle,
              media_type: mediaType,
              year,
              runtime,
              rating,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            files: [],
            subtitles: [],
            genres,
            tags: [],
            actors: [],
            directors: []
          };
          try {
            await saveMetadata(details);
            importedCount++;
          } catch (err) {
            console.error(err);
          }
        }
      }
      alert(`Bulk Import completed! Imported ${importedCount} items.`);
      fetchItems();
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 h-screen flex flex-col justify-between p-6 bg-background text-gray-200 font-mono overflow-hidden">
      {/* TOP HEADER */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
          <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
            <Database size={16} />
            <span>METADATA BULK SPREADSHEET EDITOR</span>
          </span>
          
          <div className="flex items-center space-x-4">
            {/* Import file link */}
            <label className="bg-panel border border-gray-800 text-gray-400 hover:text-gray-200 text-xs font-bold rounded px-3 py-1.5 cursor-pointer flex items-center space-x-1.5 transition-colors">
              <Upload size={14} />
              <span>IMPORT METADATA</span>
              <input
                type="file"
                accept=".csv"
                onChange={handleImportCSV}
                className="hidden"
              />
            </label>

            <button
              onClick={handleExportCSV}
              className="bg-accent text-background font-bold text-xs rounded px-4 py-1.5 hover:bg-cyan-400 flex items-center space-x-1.5 transition-colors"
            >
              <Download size={14} />
              <span>EXPORT TO CSV</span>
            </button>
          </div>
        </div>
        
        <p className="text-[10px] text-gray-500">
          Double-click on any row cell to edit values (Title, Year, Runtime, Genres). Changes will automatically synchronize back to SQLite in real time.
        </p>
      </div>

      {/* SPREADSHEET AG-GRID CONTAINER */}
      <div className="flex-1 mt-4 relative bg-panel rounded-lg border border-gray-800 overflow-hidden shadow-2xl">
        <div className="ag-theme-alpine ag-theme-quartz-dark w-full h-full text-xs">
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            onCellValueChanged={onCellValueChanged}
            theme="legacy"
          />
        </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between items-center text-[10px] text-gray-500">
        <span>TOTAL COLLECTION ENTRIES: {rowData.length} ROW RECORDS</span>
        <span className="text-accent">EDIT MODE: MULTI-CELL AUTOSAVE ACTIVE</span>
      </div>
    </div>
  );
};
