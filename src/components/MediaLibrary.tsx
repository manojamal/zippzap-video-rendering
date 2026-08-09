import React, { useState } from 'react';
import { MediaItem, CelebrativeEvent } from '../types';
import { fmtD, fmtT } from '../utils';

interface MediaLibraryProps {
  media: MediaItem[];
  onDeleteMedia: (id: string) => void;
  onUpdateMedia?: (id: string, updates: Partial<MediaItem>) => void;
  onAddToStudio: (id: string) => void;
  onAddToSlideshow: (id: string) => void;
  onPreviewMedia: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onUseSelectionInStudio: () => void;
  onUseSelectionInSlideshow: () => void;
  onNavigate: (page: string) => void;
  events?: CelebrativeEvent[];
  onClearDeliveredCache?: () => void;
}

export default function MediaLibrary({
  media,
  onDeleteMedia,
  onUpdateMedia,
  onAddToStudio,
  onAddToSlideshow,
  onPreviewMedia,
  selectedIds,
  onToggleSelection,
  onClearSelection,
  onDeleteSelected,
  onUseSelectionInStudio,
  onUseSelectionInSlideshow,
  onNavigate,
  events = [],
  onClearDeliveredCache
}: MediaLibraryProps) {
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'text' | 'photo'>('all');
  const [searchVal, setSearchVal] = useState('');
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);

  // Sorting and Archiving States
  const [sortBy, setSortBy] = useState<'date' | 'contributor' | 'type' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Determine cacheable items (items associated with an event that has status === 'delivered')
  const deliveredEventIds = new Set(events.filter(e => e.status === 'delivered').map(e => e.id));
  const cacheableItems = media.filter(m => m.event && deliveredEventIds.has(m.event));

  // Best-take detection: when the same contributor submitted more than one clip of the same
  // type for the same event (multiple retakes), flag the strongest candidate - longer duration
  // with real caption coverage (a decent Whisper transcript) beats a short, silent, or uncaptioned
  // clip - so the organizer doesn't have to scrub through every take manually.
  const bestTakeIds = React.useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const m of media) {
      if (m.type !== 'video' && m.type !== 'audio') continue;
      const key = `${m.event || 'none'}::${m.from}::${m.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    const best = new Set<string>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const scored = group.map(m => {
        const captionCoverage = Array.isArray((m as any).subtitles) ? (m as any).subtitles.filter((s: any) => s.text?.trim()).length : 0;
        return { id: m.id, score: (m.dur || 0) + captionCoverage * 3 };
      });
      scored.sort((a, b) => b.score - a.score);
      best.add(scored[0].id);
    }
    return best;
  }, [media]);

  const filteredMedia = media
    .filter(item => {
      const isArchived = archivedIds.has(item.id);
      if (showArchived) return true;
      return !isArchived;
    })
    .filter(item => filterType === 'all' || item.type === filterType)
    .filter(item => !showPendingOnly || item.approved === false)
    .filter(item => {
      const matchText = (item.name + ' ' + item.from + ' ' + (item.event || '')).toLowerCase();
      return matchText.includes(searchVal.toLowerCase());
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        const tA = a.created || 0;
        const tB = b.created || 0;
        comparison = tA - tB;
      } else if (sortBy === 'contributor') {
        comparison = (a.from || '').localeCompare(b.from || '');
      } else if (sortBy === 'type') {
        comparison = (a.type || '').localeCompare(b.type || '');
      } else if (sortBy === 'name') {
        comparison = (a.name || '').localeCompare(b.name || '');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  // Real Bulk Download simulator that triggers downloads of individual media contents
  const handleBulkDownload = () => {
    const selectedItems = media.filter(m => selectedIds.has(m.id));
    if (selectedItems.length === 0) return;

    selectedItems.forEach((item, idx) => {
      setTimeout(() => {
        let downloadUrl = item.url;
        let filename = `${item.name.replace(/\s+/g, '_')}_${item.from.replace(/\s+/g, '_')}`;

        if (item.type === 'text') {
          const textContent = `Wish from: ${item.from}\nNote: ${item.note || ''}\n\nMessage:\n${item.textBody || ''}`;
          const blob = new Blob([textContent], { type: 'text/plain' });
          downloadUrl = URL.createObjectURL(blob);
          filename += '.txt';
        } else {
          const urlExt = (item.url || '').split(/[?#]/)[0].split('.').pop();
          const fallbackExt = item.type === 'photo' ? 'jpg' : item.type === 'audio' ? 'mp3' : 'mp4';
          const ext = urlExt && /^[a-zA-Z0-9]{2,5}$/.test(urlExt) ? urlExt : fallbackExt;
          filename += `.${ext}`;
        }

        if (downloadUrl) {
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }, idx * 300); // Stagger downloads to avoid popup blocker issues
    });
    alert(`📥 Initiated Real Bulk Download of ${selectedItems.length} selected asset file(s)! Check your computer's Downloads directory.`);
  };

  const handleBulkArchive = () => {
    const selectedList = Array.from(selectedIds);
    if (selectedList.length === 0) return;

    setArchivedIds(prev => {
      const next = new Set(prev);
      selectedList.forEach(id => next.add(id));
      return next;
    });
    onClearSelection();
    alert(`🗃️ Selected ${selectedList.length} items have been archived securely! You can toggle "Show Archived" to view or restore them.`);
  };

  const handleRestoreArchive = (id: string) => {
    setArchivedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    alert(' restored from archive!');
  };

  const total = media.filter(m => !archivedIds.has(m.id)).length;
  const videos = media.filter(m => m.type === 'video' && !archivedIds.has(m.id)).length;
  const audios = media.filter(m => m.type === 'audio' && !archivedIds.has(m.id)).length;
  const photos = media.filter(m => m.type === 'photo' && !archivedIds.has(m.id)).length;
  const pendingCount = media.filter(m => m.approved === false && !archivedIds.has(m.id)).length;

  return (
    <div className="space-y-6">
      {/* Title zone */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900">🗂️ Media Library</h1>
          <p className="text-xs text-slate-500">View and organize recorded webcam clips, voices, written text, and photos</p>
        </div>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          {cacheableItems.length > 0 && (
            <button
              onClick={() => {
                if (confirm(`Are you sure you want to selectively clear ${cacheableItems.length} raw uploaded assets from delivered surprise campaigns? This frees up local sandbox memory while leaving metadata logs intact.`)) {
                  if (onClearDeliveredCache) onClearDeliveredCache();
                }
              }}
              className="px-3.5 py-2 border border-rose-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300 text-rose-500 font-extrabold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
              title="Clean up heavy media resources of delivered surprises"
            >
              <span>🧹</span> Clear Cache ({cacheableItems.length})
            </button>
          )}
          <button
            onClick={() => onNavigate('upload')}
            className="px-4 py-2 border border-slate-200 hover:border-indigo-600 hover:text-indigo-600 bg-white font-extrabold text-slate-700 text-xs rounded-xl transition cursor-pointer"
          >
            ＋ Upload Media
          </button>
          <button
            onClick={onUseSelectionInStudio}
            disabled={selectedIds.size === 0}
            className="px-4 py-2 bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition shadow-lg shadow-indigo-100 cursor-pointer animate-fade-in"
          >
            Use Selection in Studio
          </button>
        </div>
      </div>

      {/* Grid Quick summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Items</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Videos</div>
          <div className="text-2xl font-extrabold text-indigo-600 mt-1">{videos}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Voice Notes</div>
          <div className="text-2xl font-extrabold text-amber-500 mt-1">{audios}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Photos</div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">{photos}</div>
        </div>
      </div>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => setShowPendingOnly(v => !v)}
          className={`w-full flex items-center justify-between gap-2 rounded-2xl p-4 border transition cursor-pointer ${
            showPendingOnly ? 'bg-amber-100 border-amber-300' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
          }`}
        >
          <span className="text-xs font-black text-amber-800 flex items-center gap-1.5">
            ⏳ {pendingCount} submission{pendingCount === 1 ? '' : 's'} awaiting your approval
          </span>
          <span className="text-[10px] font-extrabold text-amber-700 underline">{showPendingOnly ? 'Show all' : 'Review now'}</span>
        </button>
      )}

      {/* Controls, sorting & searching */}
      <div className="bg-slate-50 border border-slate-150 rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-start lg:items-center">
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'video', 'audio', 'text', 'photo'] as const).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase transition cursor-pointer ${
                  filterType === type
                    ? 'bg-indigo-600 text-white hover:bg-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-white'
                }`}
              >
                {type === 'all'
                  ? 'All'
                  : type === 'video'
                  ? '🎬 Video'
                  : type === 'audio'
                  ? '🎙️ Audio'
                  : type === 'text'
                  ? '✍️ Text'
                  : '📸 Photo'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center w-full lg:w-auto">
            <input
              type="text"
              placeholder="🔍 Search wishes..."
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 w-full sm:w-48 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none transition"
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
            />
            {selectedIds.size > 0 && (
              <button
                onClick={onClearSelection}
                className="text-xs font-bold text-indigo-600 shrink-0 hover:underline cursor-pointer px-1"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>

        {/* ⚙️ SMART SORTING & ADVANCED SETTINGS ROW */}
        <div className="flex flex-wrap gap-4 items-center justify-between pt-2 border-t border-slate-200 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-500 font-bold">
              <span>Sort By:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-extrabold outline-none cursor-pointer focus:border-indigo-500"
              >
                <option value="date">📅 Date Submitted</option>
                <option value="contributor">👤 Contributor Name</option>
                <option value="type">🎞️ Media Type</option>
                <option value="name">✍️ Wish Title</option>
              </select>
            </div>

            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded text-slate-600 font-extrabold hover:bg-slate-100 transition cursor-pointer flex items-center gap-1"
              title="Toggle Sort Order Direction"
            >
              <span>{sortOrder === 'asc' ? '▲ Ascending' : '▼ Descending'}</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 font-bold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="rounded accent-indigo-600 cursor-pointer h-4 w-4"
              />
              <span>🗃️ Show Archived Items ({archivedIds.size})</span>
            </label>
          </div>
        </div>
      </div>

      {/* Selected Action Banner with Bulk Download & Archive */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-600 text-white rounded-2xl px-5 py-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center shadow-lg shadow-indigo-100 animate-in slide-in-from-top-4 duration-200">
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-indigo-200">Surprise Collection Cleanup Desk</div>
            <span className="text-sm font-extrabold block mt-0.5">
              🚀 {selectedIds.size} wish{selectedIds.size !== 1 ? 'es' : ''} selected in your Staging Pool
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 w-full md:w-auto">
            <button
              onClick={onUseSelectionInStudio}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-indigo-700 font-black text-xs rounded-xl transition cursor-pointer"
            >
              ＋ Timeline
            </button>
            <button
              onClick={onUseSelectionInSlideshow}
              className="px-3.5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs rounded-xl transition cursor-pointer"
            >
              🖼️ Collage Slides
            </button>
            <button
              onClick={handleBulkDownload}
              className="px-3.5 py-2 bg-indigo-700 hover:bg-indigo-850 text-white font-black text-xs rounded-xl transition cursor-pointer flex items-center gap-1"
              title="Download selected wishes directly as local files"
            >
              <span>📥</span> Bulk Download
            </button>
            <button
              onClick={handleBulkArchive}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl transition cursor-pointer flex items-center gap-1"
              title="Archive selected wishes from view"
            >
              <span>🗃️</span> Bulk Archive
            </button>
            <button
              onClick={onDeleteSelected}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl transition cursor-pointer"
            >
              🗑 Delete Permanently
            </button>
          </div>
        </div>
      )}

      {/* Media Grid Cards container */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredMedia.length > 0 ? (
          filteredMedia.map((item, idx) => {
            const isSelected = selectedIds.has(item.id);
            const pillClass =
              item.type === 'video'
                ? 'bg-purple-600'
                : item.type === 'audio'
                ? 'bg-amber-500'
                : item.type === 'text'
                ? 'bg-emerald-600'
                : 'bg-blue-600';

            return (
              <div
                key={`${item.id}_${idx}`}
                onClick={() => onToggleSelection(item.id)}
                onMouseEnter={() => setHoveredItemId(item.id)}
                onMouseLeave={() => setHoveredItemId(null)}
                className={`bg-white border rounded-2xl overflow-hidden cursor-pointer transition select-none group relative ${
                  isSelected ? 'border-2 border-indigo-600 ring-4 ring-indigo-50' : 'border-slate-200 hover:border-indigo-400'
                }`}
              >
                {/* Image Thumb Panel */}
                <div className="aspect-video w-full bg-slate-100 flex items-center justify-center overflow-hidden relative">
                  {item.type === 'video' ? (
                    item.thumb ? (
                      <img src={item.thumb} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl">🎬</span>
                    )
                  ) : item.type === 'audio' ? (
                    <div className="flex items-center gap-1.5 px-6">
                      {Array(7)
                        .fill(0)
                        .map((_, idx) => (
                          <div
                            key={idx}
                            className="w-1 bg-amber-500 rounded-full h-6 animate-pulse"
                            style={{ animationDelay: `${idx * 0.12}s`, height: `${Math.floor(Math.random() * 20) + 6}px` }}
                          ></div>
                        ))}
                    </div>
                  ) : item.type === 'photo' ? (
                    item.url ? (
                      <img src={item.url} alt={item.name} className="w-full h-full object-cover animate-fade-in" />
                    ) : (
                      <span className="text-3xl">📸</span>
                    )
                  ) : (
                    <div className="p-3 text-[10px] text-slate-500 italic bg-amber-50/50 h-full w-full flex items-center justify-center text-center overflow-hidden">
                      {item.textBody?.substring(0, 80)}...
                    </div>
                  )}

                  <span className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[8px] font-extrabold text-white uppercase ${pillClass}`}>
                    {item.type}
                  </span>
                  {item.dur > 0 && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-slate-900/80 text-white rounded text-[8px] font-mono">
                      {fmtT(item.dur)}
                    </span>
                  )}

                  {/* Play Overlay */}
                  <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onPreviewMedia(item.id);
                      }}
                      className="px-3.5 py-1.5 bg-white text-slate-900 rounded-xl text-xs font-bold transition hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      ▶ Preview
                    </button>
                  </div>
                </div>

                {/* Checked selector badge */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shadow">
                    ✓
                  </div>
                )}

                {archivedIds.has(item.id) && (
                  <span className="absolute top-2 right-8 px-1.5 py-0.5 bg-amber-500 text-white text-[8px] font-black rounded uppercase shadow-sm">
                    Archived 📁
                  </span>
                )}

                {item.approved === false && (
                  <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-amber-500 text-white text-[8px] font-black rounded uppercase shadow-sm">
                    ⏳ Pending
                  </span>
                )}

                {bestTakeIds.has(item.id) && (
                  <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[8px] font-black rounded uppercase shadow-sm">
                    ⭐ Best Take
                  </span>
                )}

                {/* Metadata content */}
                <div className="p-3.5 space-y-1">
                  <h4 className="text-xs font-extrabold text-slate-900 truncate">{item.name}</h4>
                  <p className="text-[10px] text-slate-400 truncate">
                    {item.from} · {item.size}
                  </p>

                  {item.approved === false && onUpdateMedia && (
                    <div className="flex gap-1 pt-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => onUpdateMedia(item.id, { approved: true })}
                        className="px-2 py-1 text-[9px] font-black bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-lg flex-1 transition"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Reject and delete "${item.name}"? This can't be undone.`)) onDeleteMedia(item.id);
                        }}
                        className="px-2 py-1 text-[9px] font-black bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-lg flex-1 transition"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                  
                  {/* Actions row */}
                  <div className="flex gap-1 pt-2" onClick={e => e.stopPropagation()}>
                    {archivedIds.has(item.id) ? (
                      <button
                        onClick={() => handleRestoreArchive(item.id)}
                        className="px-2 py-1 text-[9px] font-black bg-amber-50 border border-amber-250 hover:bg-amber-100 text-amber-700 rounded-lg flex-1 transition"
                      >
                        ↩ Restore File
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => onAddToStudio(item.id)}
                          className="px-2 py-1 text-[9px] font-bold bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 text-slate-700 hover:text-indigo-600 rounded-lg flex-1 transition shrink-0"
                        >
                          ＋ Studio
                        </button>
                        {item.type === 'photo' && (
                          <button
                            onClick={() => onAddToSlideshow(item.id)}
                            className="px-2 py-1 text-[9px] font-bold bg-slate-50 hover:bg-purple-50 border border-slate-100 hover:border-purple-100 text-slate-700 hover:text-purple-600 rounded-lg transition shrink-0"
                          >
                            🖼️
                          </button>
                        )}
                      </>
                    )}
                    {onUpdateMedia && (
                      <button
                        onClick={() => setOpenCommentsId(openCommentsId === item.id ? null : item.id)}
                        className="px-2 py-1 text-[9px] font-bold hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 border border-transparent rounded-lg transition"
                        title="Comments"
                      >
                        💬{item.comments && item.comments.length > 0 ? ` ${item.comments.length}` : ''}
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteMedia(item.id)}
                      className="px-2 py-1 text-[9px] font-bold hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-transparent rounded-lg transition"
                    >
                      🗑
                    </button>
                  </div>

                  {openCommentsId === item.id && onUpdateMedia && (
                    <div className="pt-2 space-y-1.5 border-t border-slate-100 mt-2" onClick={e => e.stopPropagation()}>
                      {(item.comments || []).map(c => (
                        <div key={c.id} className="bg-slate-50 rounded-lg px-2 py-1">
                          <p className="text-[9px] text-slate-600"><span className="font-extrabold">{c.author}:</span> {c.text}</p>
                        </div>
                      ))}
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={commentDraft[item.id] || ''}
                          onChange={e => setCommentDraft(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Add a comment..."
                          className="flex-1 px-2 py-1 text-[9px] bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
                          onKeyDown={e => e.stopPropagation()}
                        />
                        <button
                          onClick={() => {
                            const text = (commentDraft[item.id] || '').trim();
                            if (!text) return;
                            const newComment = { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, author: 'You', text, created: Date.now() };
                            onUpdateMedia(item.id, { comments: [...(item.comments || []), newComment] });
                            setCommentDraft(prev => ({ ...prev, [item.id]: '' }));
                          }}
                          className="px-2 py-1 text-[9px] font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
                        >
                          Post
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-2 sm:col-span-3 lg:col-span-4 text-center py-20 bg-slate-50 border border-slate-150 rounded-2xl">
            <span className="text-4xl block filter grayscale mb-3">🗂️</span>
            <p className="text-sm font-bold text-slate-800">No media entries match the selection</p>
            <p className="text-xs text-slate-400 mt-1 mb-4 select-none">Refine your search parameters or toggle the active filters.</p>
          </div>
        )}
      </div>

      {/* Grid-wide dynamic Thumbnail preview gallery of selected items on card hover */}
      {selectedIds.size > 0 && hoveredItemId && selectedIds.has(hoveredItemId) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur-md rounded-2xl p-4 border border-slate-800 text-white shadow-2xl w-full max-w-lg animate-in slide-in-from-bottom duration-300 pointer-events-auto">
          <div className="flex justify-between items-center pb-1.5 border-b border-slate-800 mb-2.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">⚡ Selected Staging Review Gallery</span>
            <span className="text-[10px] font-mono text-slate-400">{selectedIds.size} file{selectedIds.size !== 1 ? 's' : ''} staged</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1.5 min-h-[50px] scrollbar-thin">
            {media.filter(m => selectedIds.has(m.id)).map(m => (
              <div 
                key={m.id} 
                className={`relative rounded-lg overflow-hidden w-20 aspect-video border shrink-0 bg-slate-950 ${
                  m.id === hoveredItemId ? 'border-indigo-500 ring-2 ring-indigo-500/40 scale-95' : 'border-slate-800'
                } transition-all duration-150`}
                title={m.name}
              >
                {m.type === 'photo' && m.url && (
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                )}
                {m.type === 'video' && m.thumb && (
                  <img src={m.thumb} alt="" className="w-full h-full object-cover" />
                )}
                {m.type === 'video' && !m.thumb && (
                  <div className="w-full h-full flex items-center justify-center text-[10px] bg-slate-900 text-indigo-400">🎬</div>
                )}
                {m.type === 'audio' && (
                  <div className="w-full h-full flex items-center justify-center text-[10px] bg-slate-900 text-amber-500">🎙️</div>
                )}
                {m.type === 'text' && (
                  <div className="w-full h-full flex items-center justify-center text-[7px] bg-slate-900 text-emerald-400 p-0.5 overflow-hidden font-mono leading-tight">
                    {m.textBody?.substring(0, 10)}...
                  </div>
                )}
                {/* Active Hover highlight indicator */}
                {m.id === hoveredItemId && (
                  <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                    <span className="text-[7.5px] font-extrabold bg-indigo-600 text-white px-0.5 rounded-xs shadow-xs uppercase select-none">FOCUS</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-slate-800">
            <p className="text-[9.5px] text-slate-400 leading-tight">Visual validations shown automatically on selected item hover.</p>
            <button
              onClick={() => onUseSelectionInStudio()}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-extrabold rounded-lg transition-all"
            >
              Add selected to timeline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
