import React, { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useLibraryStore, MediaItemDetails, Subtitle } from "../store";
import { Search, Film, Calendar, Star, FileText, CheckCircle, XCircle, Settings, Upload, Trash2, FolderOpen, RefreshCw, Crown } from "lucide-react";

export const Library: React.FC = () => {
  const { 
    items, isLoading, isScanning, scanProgress, scanLogs, searchQuery, selectedType, 
    fetchItems, scanLibrary, saveMetadata, deleteItem, setSearchQuery, setSelectedType 
  } = useLibraryStore();

  const [selectedItem, setSelectedItem] = useState<MediaItemDetails | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [selectedTab, setSelectedTab] = useState("All");
  const [selectedShow, setSelectedShow] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [isTagsDropdownOpen, setIsTagsDropdownOpen] = useState(false);
  const [editDirectors, setEditDirectors] = useState("");
  const [editActors, setEditActors] = useState("");
  const availableTags = ["Favorites", "Kids", "Classic"];

  const formatRuntime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await invoke<string | null>("select_directory");
      if (selected) {
        setScanPath(selected);
      }
    } catch (e) {
      console.error("Failed to select folder: ", e);
    }
  };
  
  // Metadata edit fields
  const [editTitle, setEditTitle] = useState("");
  const [editOriginalTitle, setEditOriginalTitle] = useState("");
  const [editYear, setEditYear] = useState(2026);
  const [editRuntime, setEditRuntime] = useState(120);
  const [editSynopsis, setEditSynopsis] = useState("");
  const [editRating, setEditRating] = useState(5.0);
  const [editPoster, setEditPoster] = useState("");
  const [editBackdrop, setEditBackdrop] = useState("");
  const [editGenres, setEditGenres] = useState("");

  // Subtitle import fields
  const [subLang, setSubLang] = useState("en");
  const [subPath, setSubPath] = useState("");

  const [tmdbApiKey, setTmdbApiKey] = useState("");

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "tmdb_api_key" })
      .then((key) => {
        if (key) setTmdbApiKey(key);
      })
      .catch(console.error);
  }, []);

  const handleSaveTmdbKey = async (val: string) => {
    setTmdbApiKey(val);
    try {
      await invoke("set_setting", { key: "tmdb_api_key", value: val });
    } catch (e) {
      console.error("Failed to save TMDB key:", e);
    }
  };

  useEffect(() => {
    fetchItems();
    
    let unlistenFn: (() => void) | null = null;
    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("library-updated", () => {
          fetchItems(true);
        });
        unlistenFn = unlisten;
      } catch (e) {
        console.error("Failed to setup library-updated listener:", e);
      }
    };
    setupListener();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [fetchItems]);

  useEffect(() => {
    if (selectedItem) {
      const updated = items.find((item) => item.item.id === selectedItem.item.id);
      if (updated) {
        const currentScore = selectedItem.files[0]?.quality_score;
        const currentDone = selectedItem.files[0]?.quality_score_done;
        const newScore = updated.files[0]?.quality_score;
        const newDone = updated.files[0]?.quality_score_done;
        
        if (currentScore !== newScore || currentDone !== newDone) {
          setSelectedItem(updated);
        }
      }
    }
  }, [items, selectedItem]);

  const handleSelectCard = (details: MediaItemDetails) => {
    setSelectedItem(details);
    setEditTitle(details.item.title);
    setEditOriginalTitle(details.item.original_title || "");
    setEditYear(details.item.year || 2026);
    setEditRuntime(details.item.runtime);
    setEditSynopsis(details.item.synopsis || "");
    setEditRating(details.item.rating || 5.0);
    setEditPoster(details.item.poster_path || "");
    setEditBackdrop(details.item.backdrop_path || "");
    setEditGenres(details.genres.join(", "));
    setEditTags(details.tags);
    setEditDirectors((details.directors || []).join(", "));
    setEditActors((details.actors || []).join(", "));
  };

  const handleSaveMetadata = async () => {
    if (!selectedItem) return;
    const updated: MediaItemDetails = {
      ...selectedItem,
      item: {
        ...selectedItem.item,
        title: editTitle,
        original_title: editOriginalTitle,
        year: editYear,
        runtime: editRuntime,
        synopsis: editSynopsis,
        rating: editRating,
        poster_path: editPoster,
        backdrop_path: editBackdrop,
      },
      genres: editGenres.split(",").map((g) => g.trim()).filter((g) => g !== ""),
      tags: (() => {
        const dirs = editDirectors.split(",").map((d) => d.trim()).filter((d) => d !== "");
        let t = [...editTags];
        if (dirs.some(d => d.toLowerCase().includes("walt disney"))) {
          if (!t.includes("Animation")) {
            t.push("Animation");
          }
        }
        return t;
      })(),
      directors: editDirectors.split(",").map((d) => d.trim()).filter((d) => d !== ""),
      actors: editActors.split(",").map((a) => a.trim()).filter((a) => a !== ""),
    };
    await saveMetadata(updated);
    setSelectedItem(updated);
    alert("Metadata updated successfully!");
  };

  const handleImportSubtitle = async () => {
    if (!selectedItem || !subPath) return;
    try {
      // Call actual tauri command
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("import_subtitle", { 
        mediaItemId: selectedItem.item.id,
        language: subLang,
        subtitleType: "external",
        filePath: subPath 
      });
      alert("Subtitle file imported!");
      setSubPath("");
      // Refresh items
      await fetchItems();
    } catch (e) {
      alert(`Import failed: ${e}`);
    }
  };

  const handleScan = async () => {
    if (!scanPath) {
      alert("Please enter a valid path to scan");
      return;
    }
    try {
      await scanLibrary(scanPath);
    } catch (e) {
      alert(`Scan failed: ${e}`);
    }
  };

  const handleStopScan = async () => {
    try {
      await invoke("stop_scan");
    } catch (e) {
      console.error("Failed to stop scan:", e);
    }
  };

  const getShowName = (title: string) => {
    const match = title.match(/^(.*?) - S\d{2}E\d{2}/i);
    if (match) {
      return match[1].trim();
    }
    return title;
  };

  const getSeasonNumber = (title: string): number => {
    const match = title.match(/ - S(\d{2})E\d{2}/i);
    if (match) {
      return parseInt(match[1]);
    }
    return 1;
  };

  // Filter items based on search query and tag filter (represented by selectedTab)
  const filteredItems = items.filter((details) => {
    const titleMatch = details.item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       (details.item.original_title && details.item.original_title.toLowerCase().includes(searchQuery.toLowerCase()));
    
    let tagMatch = false;
    if (selectedTab === "All") {
      tagMatch = true;
    } else if (selectedTab === "Not Found") {
      // Videos for which neither AniList nor TMDb returned a match or positive result
      const poster = details.item.poster_path;
      const hasPoster = poster && (poster.startsWith("http://") || poster.startsWith("https://"));
      tagMatch = !hasPoster;
    } else {
      tagMatch = details.tags.includes(selectedTab);
    }
    
    return titleMatch && tagMatch;
  });

  const libraryTabs = ["All", "Movie", "TV show", "Documentary", "Animation", "Shorts", "Favorites", "Kids", "Classic", "Not Found"];

  const getPosterUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return convertFileSrc(path);
  };

  return (
    <div className="flex-1 h-screen flex bg-background text-gray-200 font-mono overflow-hidden">
      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col justify-between p-6 overflow-hidden">
        {/* TOP BAR / CONTROLS */}
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-800 pb-3">
            <span className="text-sm font-bold tracking-widest text-accent flex items-center space-x-2">
              <Film size={16} />
              <span>THE LIBRARY</span>
            </span>
            <div className="flex items-center space-x-3">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Scan directory path..."
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  className="bg-gray-900 border border-gray-800 rounded px-3 py-1 pr-8 text-xs w-64 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleBrowseFolder}
                  className="absolute right-2 text-gray-500 hover:text-accent focus:outline-none"
                  title="Browse Folder"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="bg-accent text-background text-xs font-bold rounded px-4 py-1 hover:bg-cyan-400 transition-colors"
              >
                {isScanning ? "SCANNING..." : "SCAN LIBRARY"}
              </button>
            </div>
          </div>

          {/* SEARCH & FILTER FILTERS */}
          <div className="flex space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
              <input
                type="text"
                placeholder="Search collection assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-10 pr-4 py-2 text-xs focus:outline-none focus:border-accent"
              />
            </div>
             <div className="flex space-x-1.5 overflow-x-auto max-w-2xl scrollbar-none">
              {libraryTabs.map((tab) => {
                const isNotFound = tab === "Not Found";
                let btnStyle = "";
                
                if (selectedTab === tab) {
                  if (isNotFound) {
                    btnStyle = "bg-amber-500/15 text-amber-500 border border-amber-500/30 font-bold shadow-[0_0_10px_rgba(245,158,11,0.15)]";
                  } else {
                    btnStyle = "bg-accent/15 text-accent border border-accent/30 font-bold";
                  }
                } else {
                  if (isNotFound) {
                    btnStyle = "bg-amber-950/5 border border-amber-950/20 text-amber-500/60 hover:text-amber-400 hover:bg-amber-950/15";
                  } else {
                    btnStyle = "bg-panel border border-gray-800 text-gray-400 hover:text-gray-200";
                  }
                }

                return (
                  <button
                    key={tab}
                    onClick={() => {
                      setSelectedTab(tab);
                      setSelectedShow(null);
                      setSelectedSeason(null);
                    }}
                    className={`text-xs px-3 py-2 rounded-lg font-mono transition-all whitespace-nowrap ${btnStyle}`}
                  >
                    {tab.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* SCAN STATUS LOGS OVERLAY */}
        {isScanning && (
          <div className="bg-cyan-950/20 border border-accent/20 rounded-lg p-3 text-xs text-accent mt-3 space-y-2">
            <div className="flex justify-between items-center font-bold">
              <span className="truncate max-w-[70%]">{scanLogs}</span>
              <div className="flex items-center space-x-3">
                <span>{scanProgress}%</span>
                <button
                  onClick={handleStopScan}
                  className="bg-rose-500/20 hover:bg-rose-500/35 text-rose-500 border border-rose-500/30 text-[10px] px-2 py-0.5 rounded font-mono transition-colors focus:outline-none"
                >
                  STOP SCAN
                </button>
              </div>
            </div>
            <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden border border-gray-800">
              <div className="bg-accent h-1.5 transition-all duration-300" style={{ width: `${scanProgress}%` }}></div>
            </div>
          </div>
        )}

        {/* POSTERS GRID */}
        <div className="flex-1 overflow-y-auto mt-4 pr-2">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              Loading library metadata index...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-600">
              No media items matching filters in this collection.
            </div>
          ) : selectedShow ? (
            (() => {
              // Level 2 / Level 3: Seasons and Episodes drill-down
              // 1. Gather all episodes for this show from all items
              const allShowEpisodes = items.filter(details => details.item.media_type === "Episode" && getShowName(details.item.title) === selectedShow);
              
              // Group episodes of the selected show by Season
              const groupedSeasons: { [seasonNum: number]: MediaItemDetails[] } = {};
              allShowEpisodes.forEach((details) => {
                const sNum = getSeasonNumber(details.item.title);
                if (!groupedSeasons[sNum]) {
                  groupedSeasons[sNum] = [];
                }
                groupedSeasons[sNum].push(details);
              });

              if (selectedSeason !== null) {
                // Render Level 3: Episodes of the selected Season
                const seasonEpisodes = groupedSeasons[selectedSeason] || [];
                return (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3 mb-2">
                      <button
                        onClick={() => setSelectedSeason(null)}
                        className="text-[10px] bg-gray-900 border border-gray-800 text-gray-400 hover:text-accent font-bold px-3 py-1.5 rounded transition-all focus:outline-none flex items-center space-x-1"
                      >
                        <span>←</span> <span>BACK TO SEASONS</span>
                      </button>
                      <span className="text-xs text-gray-500 tracking-wider">
                        {selectedShow.toUpperCase()} &gt; SEASON {selectedSeason}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                      {seasonEpisodes.map((details) => {
                        const isSelected = selectedItem?.item.id === details.item.id;
                        return (
                          <div
                            key={details.item.id}
                            onClick={() => handleSelectCard(details)}
                            className={`bg-panel border rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 shadow-lg ${
                              isSelected ? "border-accent cyan-glow" : "border-gray-800 hover:border-gray-600"
                            }`}
                          >
                            <div className="aspect-[2/3] bg-gray-950 flex items-center justify-center relative overflow-hidden">
                              {details.item.poster_path ? (
                                <img
                                  src={getPosterUrl(details.item.poster_path)}
                                  alt={details.item.title}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-gray-700 space-y-1">
                                  <Film size={32} />
                                  <span className="text-[10px] text-gray-500">NO ART</span>
                                </div>
                              )}
                              <div className="absolute top-2 left-2 flex flex-col space-y-1 items-start">
                                <div className="text-[9px] bg-black/80 px-1.5 py-0.5 rounded text-accent tracking-wider border border-accent/20">
                                  {details.item.media_type.toUpperCase()}
                                </div>
                                {details.files && details.files[0] && details.files[0].quality_score !== undefined && details.files[0].quality_score !== null && (
                                  <div className={`text-[9px] bg-amber-500/90 px-1.5 py-0.5 rounded tracking-wider font-extrabold flex items-center space-x-1 shadow border border-amber-400/20 ${
                                    details.files[0].quality_score_done === 1 ? "text-white" : "text-background"
                                  }`}>
                                    <Crown size={9} className={`fill-current ${details.files[0].quality_score_done === 1 ? "text-white" : "text-background"}`} />
                                    <span>{Math.round(details.files[0].quality_score)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="p-3 space-y-1">
                              <div className="text-xs font-bold text-gray-200 truncate">{details.item.title}</div>
                              <div className="flex justify-between items-center text-[10px] text-gray-500">
                                <span>{details.item.year || "Unknown"}</span>
                                <span className="text-[8.5px] font-mono tracking-tighter text-gray-400 bg-gray-950 px-1 py-0.5 rounded border border-gray-900">{formatRuntime(details.item.runtime)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Level 2: Seasons of the selected Show
              const seasonNums = Object.keys(groupedSeasons).map(Number).sort((a, b) => a - b);
              return (
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 mb-2">
                    <button
                      onClick={() => setSelectedShow(null)}
                      className="text-[10px] bg-gray-900 border border-gray-800 text-gray-400 hover:text-accent font-bold px-3 py-1.5 rounded transition-all focus:outline-none flex items-center space-x-1"
                    >
                      <span>←</span> <span>BACK TO TV SHOWS</span>
                    </button>
                    <span className="text-xs font-bold text-accent tracking-widest">{selectedShow.toUpperCase()}</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                    {seasonNums.map((sNum) => {
                      const seasonGroup = groupedSeasons[sNum];
                      const posterItem = seasonGroup.find(item => item.item.poster_path) || seasonGroup[0];
                      
                      return (
                        <div
                          key={sNum}
                          onClick={() => setSelectedSeason(sNum)}
                          className="bg-panel border border-gray-800 hover:border-accent/40 rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 shadow-lg"
                        >
                          <div className="aspect-[2/3] bg-gray-950 flex items-center justify-center relative overflow-hidden">
                            {posterItem.item.poster_path ? (
                              <img
                                src={getPosterUrl(posterItem.item.poster_path)}
                                alt={`Season ${sNum}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-gray-700 space-y-1">
                                <Film size={32} />
                                <span className="text-[10px] text-gray-500">NO ART</span>
                              </div>
                            )}
                            <div className="absolute top-2 left-2 text-[9px] bg-accent/80 px-1.5 py-0.5 rounded text-background tracking-wider font-extrabold shadow border border-accent/20">
                              SEASON {sNum}
                            </div>
                          </div>
                          <div className="p-3 space-y-1">
                            <div className="text-xs font-bold text-gray-200 truncate">Season {sNum}</div>
                            <div className="flex justify-between items-center text-[10px] text-accent">
                              <span className="font-bold tracking-wider font-mono">{seasonGroup.length} {seasonGroup.length === 1 ? "EPISODE" : "EPISODES"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : selectedTab === "TV show" ? (
            (() => {
              // Level 1 TV Shows list for "TV show" Tab (Only TV Show folder cards)
              const groupedShows: { [showName: string]: MediaItemDetails[] } = {};
              filteredItems.forEach((details) => {
                const showName = getShowName(details.item.title);
                if (!groupedShows[showName]) {
                  groupedShows[showName] = [];
                }
                groupedShows[showName].push(details);
              });

              const showNames = Object.keys(groupedShows);
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                  {showNames.map((showName) => {
                    const group = groupedShows[showName];
                    const firstItem = group[0];
                    const posterItem = group.find(item => item.item.poster_path);
                    const posterPath = posterItem ? posterItem.item.poster_path : firstItem.item.poster_path;
                    
                    return (
                      <div
                        key={showName}
                        onClick={() => { setSelectedShow(showName); setSelectedSeason(null); }}
                        className="bg-panel border border-gray-800 hover:border-accent/40 rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 shadow-lg"
                      >
                        <div className="aspect-[2/3] bg-gray-950 flex items-center justify-center relative overflow-hidden">
                          {posterPath ? (
                            <img
                              src={getPosterUrl(posterPath)}
                              alt={showName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-gray-700 space-y-1">
                              <Film size={32} />
                              <span className="text-[10px] text-gray-500">NO ART</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 text-[9px] bg-accent/80 px-1.5 py-0.5 rounded text-background tracking-wider font-extrabold shadow border border-accent/20">
                            TV SHOW
                          </div>
                        </div>
                        <div className="p-3 space-y-1">
                          <div className="text-xs font-bold text-gray-200 truncate">{showName}</div>
                          <div className="flex justify-between items-center text-[10px] text-accent">
                            <span className="font-bold tracking-wider font-mono">{group.length} {group.length === 1 ? "EPISODE" : "EPISODES"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            // Flat grid of items for other tabs (AND "All" tab, but with TV show folder cards substituted!)
            (() => {
              // If selectedTab === "All", we substitute all media_type === "Episode" items with their Show folder card
              const renderList: (MediaItemDetails | { isShowFolder: true, showName: string, episodes: MediaItemDetails[] })[] = [];
              const groupedEpisodes: { [showName: string]: MediaItemDetails[] } = {};

              filteredItems.forEach((details) => {
                if (details.item.media_type === "Episode") {
                  const showName = getShowName(details.item.title);
                  if (!groupedEpisodes[showName]) {
                    groupedEpisodes[showName] = [];
                  }
                  groupedEpisodes[showName].push(details);
                } else {
                  renderList.push(details);
                }
              });

              // Add TV Show folders to the list if selectedTab is "All"
              if (selectedTab === "All") {
                Object.keys(groupedEpisodes).forEach((showName) => {
                  renderList.push({
                    isShowFolder: true,
                    showName,
                    episodes: groupedEpisodes[showName],
                  });
                });
              }

              return (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                  {renderList.map((entry) => {
                    if ("isShowFolder" in entry) {
                      // Render TV Show Folder Card in "All" view
                      const group = entry.episodes;
                      const firstItem = group[0];
                      const posterItem = group.find(item => item.item.poster_path);
                      const posterPath = posterItem ? posterItem.item.poster_path : firstItem.item.poster_path;

                      return (
                        <div
                          key={entry.showName}
                          onClick={() => { setSelectedShow(entry.showName); setSelectedSeason(null); }}
                          className="bg-panel border border-gray-800 hover:border-accent/40 rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 shadow-lg"
                        >
                          <div className="aspect-[2/3] bg-gray-950 flex items-center justify-center relative overflow-hidden">
                            {posterPath ? (
                              <img
                                src={getPosterUrl(posterPath)}
                                alt={entry.showName}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-gray-700 space-y-1">
                                <Film size={32} />
                                <span className="text-[10px] text-gray-500">NO ART</span>
                              </div>
                            )}
                            <div className="absolute top-2 left-2 text-[9px] bg-accent/80 px-1.5 py-0.5 rounded text-background tracking-wider font-extrabold shadow border border-accent/20">
                              TV SHOW
                            </div>
                          </div>
                          <div className="p-3 space-y-1">
                            <div className="text-xs font-bold text-gray-200 truncate">{entry.showName}</div>
                            <div className="flex justify-between items-center text-[10px] text-accent">
                              <span className="font-bold tracking-wider font-mono">{group.length} {group.length === 1 ? "EPISODE" : "EPISODES"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Render Standard card (e.g. Movies, Bumpers)
                    const details = entry;
                    const isSelected = selectedItem?.item.id === details.item.id;
                    return (
                      <div
                        key={details.item.id}
                        onClick={() => handleSelectCard(details)}
                        className={`bg-panel border rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 shadow-lg ${
                          isSelected ? "border-accent cyan-glow" : "border-gray-800 hover:border-gray-600"
                        }`}
                      >
                        <div className="aspect-[2/3] bg-gray-950 flex items-center justify-center relative overflow-hidden">
                          {details.item.poster_path ? (
                            <img
                              src={getPosterUrl(details.item.poster_path)}
                              alt={details.item.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-gray-700 space-y-1">
                              <Film size={32} />
                              <span className="text-[10px] text-gray-500">NO ART</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 flex flex-col space-y-1 items-start">
                            <div className="text-[9px] bg-black/80 px-1.5 py-0.5 rounded text-accent tracking-wider border border-accent/20">
                              {details.item.media_type.toUpperCase()}
                            </div>
                            {details.files && details.files[0] && details.files[0].quality_score !== undefined && details.files[0].quality_score !== null && (
                              <div className={`text-[9px] bg-amber-500/90 px-1.5 py-0.5 rounded tracking-wider font-extrabold flex items-center space-x-1 shadow border border-amber-400/20 ${
                                details.files[0].quality_score_done === 1 ? "text-white" : "text-background"
                              }`}>
                                <Crown size={9} className={`fill-current ${details.files[0].quality_score_done === 1 ? "text-white" : "text-background"}`} />
                                <span>{Math.round(details.files[0].quality_score)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="p-3 space-y-1">
                          <div className="text-xs font-bold text-gray-200 truncate">{details.item.title}</div>
                          <div className="flex justify-between items-center text-[10px] text-gray-500">
                            <span>{details.item.year || "Unknown"}</span>
                            <span className="text-[8.5px] font-mono tracking-tighter text-gray-400 bg-gray-950 px-1 py-0.5 rounded border border-gray-900">{formatRuntime(details.item.runtime)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* METADATA SIDE EDIT PANEL */}
      <div 
        className={`bg-panel flex flex-col justify-between transition-all duration-300 shrink-0 ${
          selectedItem ? "w-96 p-6 border-l border-gray-800" : "w-0 p-0 border-l-0 overflow-hidden"
        }`}
      >
        {selectedItem && (
          <div className="flex flex-col h-full justify-between overflow-y-auto pr-1">
            <div className="space-y-5">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <span className="text-xs font-bold tracking-widest text-accent">METADATA INSPECTOR</span>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="text-gray-500 hover:text-gray-200 text-xs font-bold"
                >
                  CLOSE
                </button>
              </div>

              {/* Editable Fields */}
              <div className="space-y-4 text-xs">


                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">ORIGINAL TITLE</label>
                  <input
                    type="text"
                    value={editOriginalTitle}
                    onChange={(e) => setEditOriginalTitle(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200 font-sans"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">YEAR</label>
                  <input
                    type="number"
                    value={editYear}
                    onChange={(e) => setEditYear(parseInt(e.target.value))}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">GENRES (COMMA-SEPARATED)</label>
                  <input
                    type="text"
                    value={editGenres}
                    onChange={(e) => setEditGenres(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">DIRECTOR(S) (COMMA-SEPARATED)</label>
                  <input
                    type="text"
                    value={editDirectors}
                    onChange={(e) => setEditDirectors(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">CAST / ACTORS (COMMA-SEPARATED)</label>
                  <input
                    type="text"
                    value={editActors}
                    onChange={(e) => setEditActors(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200"
                  />
                </div>

                <div className="space-y-1.5 relative">
                  <label className="text-[10px] text-gray-500 tracking-wider">TAGS</label>
                  <div 
                    onClick={() => setIsTagsDropdownOpen(!isTagsDropdownOpen)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-accent font-bold font-mono text-xs cursor-pointer flex justify-between items-center min-h-[34px]"
                  >
                    <div className="flex flex-wrap gap-1">
                      {editTags.length === 0 ? (
                        <span className="text-gray-600 font-normal">Select tags...</span>
                      ) : (
                        editTags.map((tag) => (
                          <span key={tag} className="bg-accent/15 border border-accent/30 text-accent px-1.5 py-0.5 rounded text-[9px] font-bold">
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                    <span className="text-gray-500 text-[10px]">{isTagsDropdownOpen ? "▲" : "▼"}</span>
                  </div>

                  {isTagsDropdownOpen && (
                    <>
                      {/* Invisible backdrop to close the dropdown on click outside */}
                      <div className="fixed inset-0 z-40" onClick={() => setIsTagsDropdownOpen(false)} />
                      <div className="absolute left-0 right-0 mt-1 bg-gray-950 border border-gray-800 rounded-lg p-2 z-50 space-y-1 shadow-2xl max-h-48 overflow-y-auto">
                        {availableTags.map((tag) => {
                          const isChecked = editTags.includes(tag);
                          return (
                            <label 
                              key={tag} 
                              className="flex items-center space-x-2 p-1.5 rounded hover:bg-gray-900 cursor-pointer text-xs font-mono select-none"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setEditTags(editTags.filter((t) => t !== tag));
                                  } else {
                                    setEditTags([...editTags, tag]);
                                  }
                                }}
                                className="rounded border-gray-800 text-accent focus:ring-accent accent-accent"
                              />
                              <span className={isChecked ? "text-accent font-bold" : "text-gray-400"}>{tag}</span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-500 tracking-wider">SYNOPSIS</label>
                  <textarea
                    rows={4}
                    value={editSynopsis}
                    onChange={(e) => setEditSynopsis(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-accent text-gray-200 font-sans leading-relaxed text-xs"
                  />
                </div>

                {/* Subtitles Monitor panel */}
                <div className="border-t border-gray-800 pt-4 space-y-2">
                  <div className="text-[10px] text-gray-500 tracking-wider">SUBTITLES AVAILABILITY</div>
                  <div className="flex space-x-4 text-[10px] bg-gray-950 p-2.5 rounded border border-gray-800 justify-between">
                    <div className="flex items-center space-x-1.5">
                      {selectedItem.subtitles.some(s => s.language === 'en') ? <CheckCircle size={12} className="text-emerald-500" /> : <XCircle size={12} className="text-rose-500" />}
                      <span>ENGLISH SUBS</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      {selectedItem.subtitles.some(s => s.language === 'fr') ? <CheckCircle size={12} className="text-emerald-500" /> : <XCircle size={12} className="text-rose-500" />}
                      <span>FRENCH SUBS</span>
                    </div>
                  </div>
                  {/* Import subtitle box */}
                  <div className="space-y-1.5 mt-2">
                    <div className="flex space-x-2">
                      <select 
                        value={subLang} 
                        onChange={(e) => setSubLang(e.target.value)}
                        className="bg-gray-900 border border-gray-800 rounded text-xs px-2 focus:outline-none focus:border-accent"
                      >
                        <option value="en">EN</option>
                        <option value="fr">FR</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Path to subtitle file..."
                        value={subPath}
                        onChange={(e) => setSubPath(e.target.value)}
                        className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={handleImportSubtitle}
                        className="bg-gray-800 border border-gray-700 px-2 py-1 rounded hover:bg-accent hover:text-background text-[10px] flex items-center space-x-1"
                      >
                        <Upload size={10} />
                        <span>ADD</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* File Telemetry Details */}
                {selectedItem.files && selectedItem.files.length > 0 && (
                  <div className="border-t border-gray-800 pt-4 space-y-2">
                    <div className="text-[10px] text-gray-500 tracking-wider">MEDIA FILE TELEMETRY</div>
                    <div className="bg-gray-950 p-2.5 rounded border border-gray-800 space-y-2 text-[10px] font-mono text-gray-400">
                      <div className="flex justify-between border-b border-gray-900 pb-1.5">
                        <span className="text-gray-500">FILEPATH:</span>
                        <span className="text-gray-300 truncate max-w-[200px]" title={selectedItem.files[0].file_path}>
                          {selectedItem.files[0].file_path.split("/").pop()}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-gray-900 pb-1.5">
                        <span className="text-gray-500">QUALITY SCORE:</span>
                        <span className="text-accent font-bold">
                          {selectedItem.files[0].quality_score !== undefined && selectedItem.files[0].quality_score !== null
                            ? `${Math.round(selectedItem.files[0].quality_score)} / 100`
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">RESOLUTION:</span>
                        <span className="text-accent font-bold">{selectedItem.files[0].resolution || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">VIDEO CODEC:</span>
                        <span className="text-gray-300">{(selectedItem.files[0].video_codec || "unknown").toUpperCase()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">VIDEO BITRATE:</span>
                        <span className="text-gray-300">
                          {selectedItem.files[0].video_bitrate 
                            ? `${(selectedItem.files[0].video_bitrate / 1_000_000).toFixed(2)} Mbps` 
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">FRAME RATE:</span>
                        <span className="text-gray-300">
                          {selectedItem.files[0].frame_rate 
                            ? `${selectedItem.files[0].frame_rate.toFixed(3)} fps` 
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">AUDIO CODEC:</span>
                        <span className="text-gray-300">{(selectedItem.files[0].audio_codec || "unknown").toUpperCase()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">AUDIO CHANNELS:</span>
                        <span className="text-gray-300">
                          {selectedItem.files[0].audio_channels 
                            ? `${selectedItem.files[0].audio_channels} ch (${selectedItem.files[0].audio_channels === 6 ? "5.1" : selectedItem.files[0].audio_channels === 2 ? "Stereo" : "Mono"})` 
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">AUDIO LANGUAGE:</span>
                        <span className="text-gray-300">{(selectedItem.files[0].audio_language || "N/A").toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-gray-800 space-y-3">
              <button
                onClick={async () => {
                  setIsRefreshing(true);
                  try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    await invoke("refresh_item_metadata", { itemId: selectedItem.item.id });
                    alert("Metadata successfully refreshed from online API!");
                    await fetchItems();
                    const updated = useLibraryStore.getState().items.find(i => i.item.id === selectedItem.item.id);
                    if (updated) {
                      handleSelectCard(updated);
                    }
                  } catch (e) {
                    alert(`Failed to refresh metadata: ${e}`);
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
                className="w-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-500 hover:bg-emerald-500 hover:text-background font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 focus:outline-none disabled:opacity-50"
              >
                <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                <span>{isRefreshing ? "REFRESHING..." : "REFRESH FROM ONLINE"}</span>
              </button>

              <div className="flex space-x-3">
                <button
                  onClick={handleSaveMetadata}
                  className="flex-1 bg-accent text-background font-bold text-xs py-2 rounded-lg hover:bg-cyan-400 transition-colors focus:outline-none"
                >
                  SAVE CHANGES
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Delete this media item permanently from library?")) {
                      await deleteItem(selectedItem.item.id);
                      setSelectedItem(null);
                    }
                  }}
                  className="bg-rose-950/20 border border-rose-800 text-rose-500 p-2 rounded-lg hover:bg-rose-600 hover:text-white transition-colors focus:outline-none"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
