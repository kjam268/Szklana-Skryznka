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
    const mapped = items.map((details) => ({
      id: details.item.id,
      title: details.item.title,
      original_title: details.item.original_title || "",
      media_type: details.item.media_type,
      year: details.item.year || 2026,
      runtime: details.item.runtime,
      rating: details.item.rating || 5.0,
      genres: details.genres.join(", "),
      files_count: details.files.length,
      subtitles_count: details.subtitles.length,
      quality_score: details.files[0]?.quality_score !== undefined && details.files[0]?.quality_score !== null
        ? `${details.files[0].quality_score.toFixed(1)} / 10.0`
        : "N/A",
    }));
    setRowData(mapped);
  }, [items]);

  const columnDefs = [
    { field: "id", headerName: "ID", width: 140, editable: false },
    { field: "title", headerName: "TITLE", width: 180, editable: true },
    { field: "original_title", headerName: "ORIGINAL TITLE", width: 160, editable: true },
    { field: "media_type", headerName: "MEDIA TYPE", width: 120, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: {
        values: ["Movie", "TVShow", "Episode", "Anime", "Documentary", "Educational", "Bumper", "StationID", "Trailer", "Commercial"]
      } 
    },
    { field: "year", headerName: "YEAR", width: 90, editable: true },
    { field: "runtime", headerName: "RUNTIME (SEC)", width: 120, editable: true },
    { field: "rating", headerName: "RATING", width: 90, editable: true },
    { field: "genres", headerName: "GENRES", width: 140, editable: true },
    { field: "quality_score", headerName: "QUALITY", width: 100, editable: false },
    { field: "files_count", headerName: "FILES", width: 80, editable: false },
    { field: "subtitles_count", headerName: "SUBS", width: 80, editable: false },
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
        rating: parseFloat(data.rating),
      },
      genres: data.genres.split(",").map((g: string) => g.trim()).filter((g: string) => g !== ""),
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
