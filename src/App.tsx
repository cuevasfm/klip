import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Search, Star, Clipboard, Calendar, X, Settings, ExternalLink, Image as ImageIcon, ScanText, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import SettingsModal from "./components/SettingsModal";
import Tesseract from 'tesseract.js';

interface Clip {
  id: string;
  content: string;
  created_at: string;
  is_favorite: boolean;
  clip_type: 'text' | 'image';
  image_path?: string;
}

interface Toast {
  message: string;
  visible: boolean;
}

function App() {
  const { t } = useTranslation();
  const [clips, setClips] = useState<Clip[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [processingOcr, setProcessingOcr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>({ message: "", visible: false });
  const [expandedClips, setExpandedClips] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedClips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
  };

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    // Check local storage or system preference
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    // return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return 'dark'; // Default to dark for consistency with previous state if undefined
  });

  // Apply Theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const fetchClips = async (searchText: string = "", dateFilter: string | null = null) => {
    try {
      const result = await invoke<Clip[]>("get_clips", {
        searchText: searchText || null,
        dateFilter: dateFilter
      });
      setClips(result);
    } catch (error) {
      console.error("Failed to fetch clips:", error);
    }
  };

  const fetchDates = async () => {
    try {
      const result = await invoke<string[]>("get_dates_with_clips");
      setDates(result);
    } catch (error) {
      console.error("Failed to fetch dates", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_clip", { id });
      fetchClips(search, selectedDate);
      fetchDates();
    } catch (error) {
      console.error("Failed to delete clip", error);
    }
  };

  // Initial load
  useEffect(() => {
    fetchClips(search, selectedDate);
    fetchDates();

    const unlisten = listen("clipboard-changed", () => {
      // Refresh list and dates
      fetchClips(search, selectedDate);
      fetchDates();
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchClips(search, selectedDate);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]); // Intentionally exclude selectedDate to avoid double fetch if possible, though needed if we want to combine them instantly.

  // When date changes
  useEffect(() => {
    fetchClips(search, selectedDate);
  }, [selectedDate]);

  const handleCopy = async (content: string, clip: Clip) => {
    if (clip.clip_type === 'image' && clip.image_path) {
      // For image clips, we might copy the text if the main container is clicked
      // Check if it has text content that was extracted
      if (clip.content) {
        await invoke("copy_to_clipboard", { content: clip.content });
        showToast(t('text_copied') || "Text copied");
      }
    } else {
      await invoke("copy_to_clipboard", { content });
      showToast(t('text_copied') || "Text copied");
    }
  };

  const handleCopyImage = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await invoke("copy_image_to_clipboard", { path });
      showToast(t('image_copied') || "Image copied");
    } catch (err) {
      console.error("Failed to copy image", err);
      showToast("Failed to copy image");
    }
  };

  const isUrl = (text: string) => {
    return /^(http|https):\/\/[^ "]+$/.test(text);
  };

  const handleOpenUrl = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation(); // Prevent copy
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL", err);
    }
  };

  const handleExtractText = async (e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    if (!clip.image_path) return;

    setProcessingOcr(clip.id);
    try {
      const assetUrl = convertFileSrc(clip.image_path);
      const { data: { text } } = await Tesseract.recognize(
        assetUrl,
        'eng+spa', // Use both english and spanish
        { logger: m => console.log(m) }
      );

      if (text) {
        await invoke("update_clip_content", { id: clip.id, content: text });
        // Refresh to show content
        fetchClips(search, selectedDate);
      }
    } catch (err) {
      console.error("OCR Failed", err);
    } finally {
      setProcessingOcr(null);
    }
  };

  return (
    <div className={clsx("flex h-screen font-sans transition-colors duration-200", theme === 'dark' ? "bg-[#1e1e1e] text-gray-200" : "bg-gray-50 text-gray-800")}>

      {/* Sidebar - Dates */}
      <div className={clsx("w-48 border-r flex flex-col", theme === 'dark' ? "bg-[#252526] border-[#333]" : "bg-gray-100 border-gray-200")}>
        <div className={clsx("p-4 border-b font-semibold text-sm flex items-center justify-between", theme === 'dark' ? "border-[#333] text-gray-400" : "border-gray-200 text-gray-600")}>
          <div className="flex items-center">
            <Calendar className="w-4 h-4 mr-2" />
            {t('history')}
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="hover:bg-opacity-20 hover:bg-gray-500 p-1 rounded transition-colors"
            title={t('settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            className={clsx(
              "cursor-pointer px-4 py-3 text-sm transition-colors",
              theme === 'dark' ? "hover:bg-[#2a2d2e]" : "hover:bg-gray-200",
              selectedDate === null && (theme === 'dark' ? "bg-[#37373d] text-white font-medium" : "bg-white text-blue-600 font-medium shadow-sm")
            )}
            onClick={() => setSelectedDate(null)}
          >
            {t('all_available')}
          </div>
          {dates.map(date => (
            <div
              key={date}
              className={clsx(
                "cursor-pointer px-4 py-2 text-sm transition-colors border-l-2",
                theme === 'dark' ? "hover:bg-[#2a2d2e]" : "hover:bg-gray-200",
                selectedDate === date
                  ? (theme === 'dark' ? "bg-[#37373d] text-white border-blue-500" : "bg-white text-blue-600 border-blue-500 shadow-sm")
                  : "border-transparent " + (theme === 'dark' ? "text-gray-400" : "text-gray-600")
              )}
              onClick={() => setSelectedDate(date)}
            >
              {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search Bar - Sticky */}
        <div className={clsx("sticky top-0 z-10 border-b p-4 shadow-sm flex items-center space-x-2", theme === 'dark' ? "bg-[#1e1e1e] border-[#333]" : "bg-gray-50 border-gray-200")}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder={t('search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={clsx(
                "w-full rounded-md pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500",
                theme === 'dark' ? "bg-[#3c3c3c] text-white" : "bg-white text-gray-900 border border-gray-300"
              )}
            />
          </div>
          {selectedDate && (
            <div className="flex items-center text-xs bg-blue-900/30 text-blue-200 px-2 py-1 rounded border border-blue-800">
              <span>{selectedDate}</span>
              <button onClick={() => setSelectedDate(null)} className="ml-2 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Clips List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {clips.length === 0 ? (
            <div className="text-center text-gray-500 mt-20">
              <Clipboard className="mx-auto w-12 h-12 mb-2 opacity-50" />
              <p>{t('no_clips')}</p>
              {selectedDate && <p className="text-xs mt-1 text-gray-600">{t('no_clips_for_date', { date: selectedDate })}</p>}
            </div>
          ) : (
            clips.map((clip) => {
              const isLink = isUrl(clip.content);
              const isImage = clip.clip_type === 'image';

              return (
                <div
                  key={clip.id}
                  onClick={() => handleCopy(clip.content, clip)}
                  className={clsx(
                    "group p-3 rounded-md cursor-pointer transition-colors border relative",
                    theme === 'dark'
                      ? "bg-[#2d2d2d] hover:bg-[#37373d] border-transparent hover:border-[#444]"
                      : "bg-white hover:bg-gray-50 border-gray-200 hover:border-blue-300 shadow-sm"
                  )}
                >
                  <div className="flex justify-between items-start">
                    {/* Content Area */}
                    <div className={clsx("flex-1 pr-4 min-w-0")}>
                      {isImage && clip.image_path ? (
                        <div className="flex flex-row gap-4">
                          {/* Image Only */}
                          <div className="flex-none">
                            <img
                              src={convertFileSrc(clip.image_path)}
                              alt="Clipboard Image"
                              className="max-h-48 rounded border border-gray-600 object-contain bg-black/50"
                              loading="lazy"
                            />
                            <button
                              onClick={(e) => handleCopyImage(e, clip.image_path!)}
                              className={clsx(
                                "mt-2 w-full text-xs py-1 rounded border transition-colors flex items-center justify-center gap-1",
                                theme === 'dark' ? "border-gray-600 hover:bg-gray-700 text-gray-300" : "border-gray-200 hover:bg-gray-100 text-gray-600"
                              )}
                            >
                              <Clipboard className="w-3 h-3" />
                              {t('copy_image') || "Copy Image"}
                            </button>
                          </div>

                          {/* Extracted Text Side */}
                          {clip.content && (
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('extracted_text') || "Extracted Text"}</span>
                              </div>
                              <p className={clsx("text-sm whitespace-pre-wrap font-mono line-clamp-[10] flex-1", theme === 'dark' ? "text-gray-300" : "text-gray-700")}>
                                {clip.content}
                              </p>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(clip.content, clip);
                                }}
                                className={clsx(
                                  "mt-2 self-start text-xs py-1 px-2 rounded border transition-colors flex items-center gap-1",
                                  theme === 'dark' ? "border-gray-600 hover:bg-gray-700 text-gray-300" : "border-gray-200 hover:bg-gray-100 text-gray-600"
                                )}
                              >
                                <Clipboard className="w-3 h-3" />
                                {t('copy_text') || "Copy Text"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className={clsx(
                            "text-sm font-mono whitespace-pre-wrap break-all transition-all duration-200",
                            theme === 'dark' ? "text-gray-100" : "text-gray-800",
                            !expandedClips.has(clip.id) && clip.content.length > 300 && "line-clamp-6"
                          )}>
                            {clip.content}
                          </p>
                          {clip.content.length > 300 && (
                            <button
                              onClick={(e) => toggleExpanded(clip.id, e)}
                              className="mt-1 text-xs text-blue-500 hover:text-blue-400 font-medium focus:outline-none"
                            >
                              {expandedClips.has(clip.id) ? t('show_less') : t('show_more')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex space-x-2 ml-2 min-w-[20px] justify-end items-start flex-col gap-2">
                      {/* Link Action */}
                      {isLink && (
                        <button
                          onClick={(e) => handleOpenUrl(e, clip.content)}
                          className={clsx("p-1 rounded hover:bg-opacity-20", theme === 'dark' ? "hover:bg-blue-400 text-blue-400" : "hover:bg-blue-200 text-blue-600")}
                          title="Open Link"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      )}

                      {/* OCR Action for Images */}
                      {isImage && (
                        <button
                          onClick={(e) => handleExtractText(e, clip)}
                          disabled={processingOcr === clip.id}
                          className={clsx(
                            "p-1 rounded hover:bg-opacity-20 transition-all",
                            theme === 'dark' ? "hover:bg-green-400 text-green-400" : "hover:bg-green-200 text-green-600",
                            processingOcr === clip.id && "animate-pulse opacity-50"
                          )}
                          title={t('extract_text')}
                        >
                          <ScanText className="w-4 h-4" />
                        </button>
                      )}

                      {/* Generic Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(clip.id);
                          }}
                          className={clsx(
                            "p-1 rounded hover:bg-opacity-20 transition-all opacity-0 group-hover:opacity-100",
                            theme === 'dark' ? "hover:bg-red-400 text-red-500" : "hover:bg-red-200 text-red-600"
                          )}
                          title={t('delete')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        {clip.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-current" />}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between items-center text-xs text-gray-500">
                    <span>{new Date(clip.created_at).toLocaleTimeString()}</span>
                    <span className={clsx("px-1.5 py-0.5 rounded text-[10px] border flex items-center gap-1", theme === 'dark' ? "bg-[#1e1e1e] border-[#333]" : "bg-gray-100 border-gray-300 text-gray-600")}>
                      {isImage ? (
                        <><ImageIcon className="w-2.5 h-2.5" /> {t('image')}</>
                      ) : isLink ? "LINK" : "TEXT"}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div >

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Toast Notification */}
      <div
        className={clsx(
          "fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg transition-all duration-300 z-50",
          theme === 'dark' ? "bg-white text-black" : "bg-black text-white",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none"
        )}
      >
        {toast.message}
      </div>
    </div >
  );
}

export default App;
