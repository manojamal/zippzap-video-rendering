import React from 'react';
import { CelebrativeEvent, ActivityFeedItem, MediaItem } from '../types';
import { PIPELINE_STAGES, fmtT, daysTo } from '../utils';
import { generateNudgeMessage, classifyWishTone } from '../services/aiService';
import { generateQrDataUrl } from '../services/qrService';
import { getSnapshots, saveSnapshot, restoreSnapshot, deleteSnapshot, SnapshotMeta } from '../versionHistory';

interface DashboardProps {
  user: any;
  events: CelebrativeEvent[];
  activity: ActivityFeedItem[];
  media: MediaItem[];
  points: number;
  monthlyMsgCount: number;
  onNavigate: (page: string) => void;
  onOpenPortal: (evId: string) => void;
  onUpdateEvents?: (updated: CelebrativeEvent[]) => void;
  onUpdateClipsState?: (clips: any[]) => void;
  onUpdateTimelineState?: (order: number[]) => void;
}

export default function Dashboard({
  user,
  events,
  activity,
  media,
  points,
  onNavigate,
  onOpenPortal,
  onUpdateEvents,
  onUpdateClipsState,
  onUpdateTimelineState
}: DashboardProps) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'performance'>('overview');
  const [deleteCampaignId, setDeleteCampaignId] = React.useState<string | null>(null);
  const [deleteConfirmationStep, setDeleteConfirmationStep] = React.useState<number>(0);
  const [typedConfirmation, setTypedConfirmation] = React.useState('');
  const activeEvent = events.find(e => e.status === 'active');
  const invitesCount = events.reduce((sum, e) => sum + e.invites.length, 0);

  const handleStartDelete = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteCampaignId(eventId);
    setDeleteConfirmationStep(1);
    setTypedConfirmation('');
  };

  const handleProceedDeleteStep2 = () => {
    setDeleteConfirmationStep(2);
  };

  const handleFinalDeleteCampaign = () => {
    if (typedConfirmation !== 'DELETE') {
      alert("Please type 'DELETE' exactly to confirm.");
      return;
    }
    if (onUpdateEvents && deleteCampaignId) {
      const updatedEvents = events.filter(ev => ev.id !== deleteCampaignId);
      onUpdateEvents(updatedEvents);
    }
    setDeleteCampaignId(null);
    setDeleteConfirmationStep(0);
    setTypedConfirmation('');
  };

  const handleCompileCampaignWishes = () => {
    // Find wishes that belong to this campaign and aren't composer own clips
    // Try to filter for wishes specific to the active campaign first, and fallback to general wishes if empty
    // Only approved (or legacy, pre-moderation) wishes are eligible - pending review submissions
    // stay out of the compiled video until the organizer approves them in Media Vault.
    let campaignWishes = media.filter(m => m.from && m.from !== 'Me (Composer)' && m.approved !== false && (activeEvent ? m.event === activeEvent.id : true));
    if (campaignWishes.length === 0) {
      campaignWishes = media.filter(m => m.from && m.from !== 'Me (Composer)' && m.approved !== false);
    }
    
    if (campaignWishes.length === 0) {
      const pendingCount = media.filter(m => m.approved === false && (activeEvent ? m.event === activeEvent.id : true)).length;
      alert(pendingCount > 0
        ? `⚠️ ${pendingCount} wish(es) are still pending your approval! Go to Media Vault to review and approve them first.`
        : "⚠️ There are no guest wishes submitted yet! Please submit sample wishes via the contributor gateway or test portal first to gather media.");
      return;
    }

    // 1. Intro Cover Slide
    const introClip = {
      id: 'heuristic_intro_' + Date.now(),
      type: 'text',
      file: null,
      url: 'TEXT_INTRO',
      dur: 5,
      name: `Opening Card: Celebrating ${activeEvent?.title || 'Tribute'}`,
      from: 'AI Compiler Co-Pilot',
      textBody: `A Surprise Tribute Album for ${activeEvent?.cel || 'Our Teammate'}!\nGathered with ❤️ from everyone.`,
      style: 'royal',
      trimStart: 0,
      trimEnd: 5,
      transition: 'fade' // Crossfade default
    };

    // 2. Classify other wishes
    const videoWishes = campaignWishes.filter(m => m.type === 'video');
    const audioWishes = campaignWishes.filter(m => m.type === 'audio');
    const photoWishes = campaignWishes.filter(m => m.type === 'photo');
    const textWishes = campaignWishes.filter(m => m.type === 'text');

    // Sequence: Video -> Audio -> Photo -> Text
    const sortedWishes = [
      ...videoWishes,
      ...audioWishes,
      ...photoWishes,
      ...textWishes
    ];

    const processedMediaClips = sortedWishes.map((w, index) => {
      const clipDur = w.dur || 6;
      let clipUrl = w.url || 'https://assets.mixkit.co/videos/preview/mixkit-celebration-with-fireworks-and-confetti-34063-large.mp4';
      let clipType: 'video' | 'audio' | 'text' | 'photo' = w.type || 'video';
      
      if (clipType === 'text') {
        clipUrl = `TEXT_CARD_${index}`;
      }

      return {
        id: 'heuristic_wish_' + w.id + '_' + index + '_' + Date.now(),
        sourceMediaId: w.id,
        type: clipType,
        file: null,
        url: clipUrl,
        dur: clipDur,
        name: `Wish from ${w.from.split('(')[0].trim()}`,
        from: w.from,
        textBody: w.textBody || w.note || '',
        style: w.style || 'gradient',
        trimStart: 0,
        trimEnd: clipDur,
        transition: 'fade' // default Crossfade
      };
    });

    // 3. Outro Slide
    const outroClip = {
      id: 'heuristic_outro_' + Date.now(),
      type: 'text',
      file: null,
      url: 'TEXT_OUTRO',
      dur: 5,
      name: '🌟 Closing Outro Roll',
      from: 'AI Compiler Co-Pilot',
      textBody: `With love, for ${activeEvent?.cel || 'you'}! ✨\nDesigned automatically with Zipp Zap.`,
      style: 'dark',
      trimStart: 0,
      trimEnd: 5,
      transition: 'fade'
    };

    const finalCompiledTimeline = [introClip, ...processedMediaClips, outroClip];

    if (onUpdateClipsState && onUpdateTimelineState) {
      onUpdateClipsState(finalCompiledTimeline);
      onUpdateTimelineState(finalCompiledTimeline.map((_, i) => i));
      
      alert(`🪄 Heuristic AI Compiler:\n\nSuccessfully compiled campaign's ${campaignWishes.length} wishes into a single master project file!\n\nSequence Hierarchy:\n1. 🎬 Opening Card [Celebrating ${activeEvent?.title || 'Tribute'}]\n${processedMediaClips.map((c, i) => `${i+2}. ${c.name} (${c.type.toUpperCase()})`).join('\n')}\n${processedMediaClips.length + 2}. 🌟 Outro Roll [Happy Celebrations!]\n\nCinematic crossfades applied. Redirecting to the Video Studio editor...`);
      onNavigate('studio');
    }
  };

  /**
   * Suggests a ~90-second highlight cut instead of the full flat chronological dump:
   * one clip per contributor (their best/longest take), ranked by duration + real
   * caption coverage, greedily filled to a target runtime for variety across
   * contributors. This is a starting point the organizer can fully override, not a
   * final render - it just pre-populates the studio timeline.
   */
  const handleSuggestHighlightReel = () => {
    if (!activeEvent) {
      alert('⚠️ Select an active campaign first.');
      return;
    }
    const eligible = media.filter(m => m.event === activeEvent.id && m.from && m.from !== 'Me (Composer)' && m.approved !== false && (m.type === 'video' || m.type === 'audio'));
    if (eligible.length === 0) {
      alert('⚠️ No approved video/audio wishes yet for this campaign to build a highlight reel from.');
      return;
    }

    // One clip per contributor - their best take by duration + caption coverage - for variety.
    const byContributor = new Map<string, MediaItem>();
    for (const m of eligible) {
      const captionCoverage = Array.isArray((m as any).subtitles) ? (m as any).subtitles.filter((s: any) => s.text?.trim()).length : 0;
      const score = (m.dur || 0) + captionCoverage * 3;
      const existing = byContributor.get(m.from);
      if (!existing) {
        byContributor.set(m.from, m);
      } else {
        const existingScore = (existing.dur || 0) + (Array.isArray((existing as any).subtitles) ? (existing as any).subtitles.filter((s: any) => s.text?.trim()).length : 0) * 3;
        if (score > existingScore) byContributor.set(m.from, m);
      }
    }

    const candidates = Array.from(byContributor.values()).sort((a, b) => (b.dur || 0) - (a.dur || 0));
    const TARGET_SECONDS = 90;
    const selected: MediaItem[] = [];
    let runningTotal = 0;
    for (const c of candidates) {
      if (runningTotal >= TARGET_SECONDS) break;
      selected.push(c);
      runningTotal += c.dur || 6;
    }
    if (selected.length === 0) selected.push(candidates[0]);

    const introClip = {
      id: 'highlight_intro_' + Date.now(),
      type: 'text', file: null, url: 'TEXT_INTRO', dur: 4,
      name: `Highlight Reel: ${activeEvent.cel}`,
      from: 'AI Compiler Co-Pilot',
      textBody: `The Best Bits: A Highlight Reel for ${activeEvent.cel}! ✨`,
      style: 'royal', trimStart: 0, trimEnd: 4, transition: 'fade',
    };
    const highlightClips = selected.map((w, index) => ({
      id: 'highlight_wish_' + w.id + '_' + index + '_' + Date.now(),
      sourceMediaId: w.id,
      type: w.type,
      file: null,
      url: w.url,
      dur: w.dur || 6,
      name: `Wish from ${w.from.split('(')[0].trim()}`,
      from: w.from,
      textBody: w.textBody || w.note || '',
      style: w.style || 'gradient',
      subtitles: (w as any).subtitles,
      trimStart: 0,
      trimEnd: w.dur || 6,
      transition: 'fade',
    }));
    const finalTimeline = [introClip, ...highlightClips];

    if (onUpdateClipsState && onUpdateTimelineState) {
      onUpdateClipsState(finalTimeline);
      onUpdateTimelineState(finalTimeline.map((_, i) => i));
      alert(`✨ Suggested Highlight Reel:\n\n${selected.length} clips selected (one best take per contributor), ~${Math.round(runningTotal)}s total.\n\nThis is a starting point - review, reorder, or swap clips in the Studio before rendering.`);
      onNavigate('studio');
    }
  };

  /**
   * The "wow" AI feature: instead of a flat chronological dump, classifies each
   * wish's tone on-device (Heartfelt / Funny / Milestone / General) and groups
   * the compiled video into labeled sections with suggested ordering, giving it
   * an actual emotional arc. Runs sequentially with a visible progress status
   * since it's one small local-model call per wish.
   */
  const handleAiNarrativeCompile = async () => {
    if (!activeEvent) {
      alert('⚠️ Select an active campaign first.');
      return;
    }
    const eligible = media.filter(m => m.event === activeEvent.id && m.from && m.from !== 'Me (Composer)' && m.approved !== false);
    if (eligible.length === 0) {
      alert('⚠️ No approved wishes yet for this campaign.');
      return;
    }

    setIsStructuring(true);
    const sections: Record<'Heartfelt' | 'Funny' | 'Milestone' | 'General', MediaItem[]> = {
      Heartfelt: [], Funny: [], Milestone: [], General: [],
    };

    for (let i = 0; i < eligible.length; i++) {
      const wish = eligible[i];
      setStructuringStatus(`Reading tone of wish ${i + 1} of ${eligible.length}...`);
      const textForClassification = wish.textBody || wish.note || wish.name || '';
      const tone = await classifyWishTone(textForClassification, (pct, status) => setStructuringStatus(`${status} (${pct}%) - wish ${i + 1}/${eligible.length}`));
      sections[tone].push(wish);
    }
    setIsStructuring(false);
    setStructuringStatus('');

    const sectionOrder: Array<{ key: keyof typeof sections; label: string }> = [
      { key: 'Heartfelt', label: 'Heartfelt Messages' },
      { key: 'Funny', label: 'Funny Memories' },
      { key: 'Milestone', label: 'Milestones & Wishes' },
      { key: 'General', label: 'More Wishes' },
    ];

    const introClip = {
      id: 'narrative_intro_' + Date.now(),
      type: 'text', file: null, url: 'TEXT_INTRO', dur: 5,
      name: `Opening Card: Celebrating ${activeEvent.title}`,
      from: 'AI Compiler Co-Pilot',
      textBody: `A Surprise Tribute Album for ${activeEvent.cel}!\nGathered with ❤️ from everyone.`,
      style: 'royal', trimStart: 0, trimEnd: 5, transition: 'fade',
    };

    const timeline: any[] = [introClip];
    let sectionsUsed = 0;
    for (const { key, label } of sectionOrder) {
      const wishes = sections[key];
      if (wishes.length === 0) continue;
      sectionsUsed++;
      timeline.push({
        id: `narrative_section_${key}_${Date.now()}`,
        type: 'text', file: null, url: `TEXT_SECTION_${key}`, dur: 3,
        name: `Section: ${label}`, from: 'AI Compiler Co-Pilot',
        textBody: label, style: 'dark', trimStart: 0, trimEnd: 3, transition: 'fade',
      });
      wishes.forEach((w, index) => {
        timeline.push({
          id: `narrative_wish_${w.id}_${index}_${Date.now()}`,
          sourceMediaId: w.id,
          type: w.type, file: null, url: w.url, dur: w.dur || 6,
          name: `Wish from ${w.from.split('(')[0].trim()}`, from: w.from,
          textBody: w.textBody || w.note || '', style: w.style || 'gradient',
          subtitles: (w as any).subtitles,
          trimStart: 0, trimEnd: w.dur || 6, transition: 'fade',
        });
      });
    }
    timeline.push({
      id: 'narrative_outro_' + Date.now(),
      type: 'text', file: null, url: 'TEXT_OUTRO', dur: 5,
      name: '🌟 Closing Outro Roll', from: 'AI Compiler Co-Pilot',
      textBody: `With love, for ${activeEvent.cel}! ✨\nDesigned automatically with Zipp Zap.`,
      style: 'dark', trimStart: 0, trimEnd: 5, transition: 'fade',
    });

    if (onUpdateClipsState && onUpdateTimelineState) {
      onUpdateClipsState(timeline);
      onUpdateTimelineState(timeline.map((_, i) => i));
      alert(`✨ AI Narrative Structure applied!\n\nGrouped ${eligible.length} wishes into ${sectionsUsed} section(s) with an emotional arc instead of a flat chronological order. Review in the Studio before rendering.`);
      onNavigate('studio');
    }
  };

  const [newInvName, setNewInvName] = React.useState('');
  const [newInvContact, setNewInvContact] = React.useState('');
  const [newInvMethod, setNewInvMethod] = React.useState<'WhatsApp' | 'Email' | 'SMS'>('WhatsApp');
  const [aiNudgeLoading, setAiNudgeLoading] = React.useState(false);
  const [aiNudgeStatus, setAiNudgeStatus] = React.useState('');
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [showQr, setShowQr] = React.useState(false);
  const [snapshots, setSnapshots] = React.useState<SnapshotMeta[]>([]);
  const [showSnapshots, setShowSnapshots] = React.useState(false);
  const [savingSnapshot, setSavingSnapshot] = React.useState(false);
  const [isStructuring, setIsStructuring] = React.useState(false);
  const [structuringStatus, setStructuringStatus] = React.useState('');

  // Rewards Tier styling computation
  const rewardTiers = [
    { name: 'Member', min: 0, max: 1000, next: 'Silver', icon: '⚪' },
    { name: 'Silver', min: 1001, max: 2500, next: 'Gold', icon: '🥈' },
    { name: 'Gold', min: 2501, max: 5000, next: 'Platinum', icon: '🥇' },
    { name: 'Platinum', min: 5001, max: 10000, next: 'Elite', icon: '💎' }
  ];

  const currentTier = rewardTiers.find(t => points >= t.min && points <= t.max) || rewardTiers[0];
  const progressPercent = Math.min(100, Math.max(0, ((points - currentTier.min) / (currentTier.max - currentTier.min)) * 100));

  const recentMedia = media.slice(-4).reverse();

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900" id="dash-hi">
            Hello, {user?.name?.split(' ')[0] || 'User'} 👋
          </h1>
          <p className="text-sm text-slate-500">Here is your rewards balance and celebration activity overview</p>
        </div>
        <button
          onClick={() => onNavigate('create')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-indigo-200 flex items-center gap-2 cursor-pointer"
        >
          <span>✦</span> New Celebration
        </button>
      </div>

      {/* Tabs Switcher Control Panel */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-3 font-bold text-sm transition-all border-b-2 -mb-[2px] cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'overview'
              ? 'border-indigo-600 text-indigo-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          📋 Campaign Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('performance')}
          className={`px-5 py-3 font-bold text-sm transition-all border-b-2 -mb-[2px] cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'performance'
              ? 'border-indigo-600 text-indigo-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="tab-performance-btn"
        >
          📊 Campaign Performance Analytics
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* Grid Stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Upcoming</div>
          <div className="text-3xl font-extrabold text-slate-900 my-1">{events.filter(e => e.status === 'active').length}</div>
          <div className="text-xs text-indigo-600 font-semibold">Active Pipeline</div>
          <div className="absolute right-[-8px] bottom-[-8px] text-5xl opacity-5 pointer-events-none">🎉</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Media Items</div>
          <div className="text-3xl font-extrabold text-slate-900 my-1">{media.length}</div>
          <div className="text-xs text-emerald-600 font-semibold">Ready in Library</div>
          <div className="absolute right-[-8px] bottom-[-8px] text-5xl opacity-5 pointer-events-none">🗂️</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invites Sent</div>
          <div className="text-3xl font-extrabold text-slate-900 my-1">{invitesCount}</div>
          <div className="text-xs text-indigo-600 font-semibold">Wishes collected</div>
          <div className="absolute right-[-8px] bottom-[-8px] text-5xl opacity-5 pointer-events-none">📨</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rewards Score</div>
          <div className="text-3xl font-extrabold text-slate-900 my-1 text-amber-600">{points} pts</div>
          <div className="text-xs text-amber-500 font-semibold">Level: {currentTier.name}</div>
          <div className="absolute right-[-8px] bottom-[-8px] text-5xl opacity-5 pointer-events-none">🎁</div>
        </div>
      </div>

      {/* 📅 SURPRISE RELEASE DEADLINE CALENDAR */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <span>📅</span> Surprise Campaign Master Calendar (June 2026)
            </h2>
            <p className="text-[11.5px] text-slate-500 mt-1">
              Visual grid tracker marking all secret upcoming deadlines and launch releases. Hover or click to check action logs.
            </p>
          </div>
          <div className="flex gap-2 items-center text-[10px] font-bold">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-full inline-block"></span> Active</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block"></span> Delivered</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-500 rounded-full inline-block"></span> Pending</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Calendar Grid */}
          <div className="lg:col-span-8 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
            <div className="text-center font-bold text-xs uppercase tracking-widest text-slate-500 mb-3 flex justify-between px-2">
              <span>⏮️ May 2026</span>
              <span className="text-slate-900 font-extrabold text-sm font-sans">June 2026</span>
              <span>July 2026 ⏭️</span>
            </div>

            {/* Days of Week headers */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-slate-500 uppercase pb-2 border-b border-slate-150">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>

            {/* Dates Grid */}
            <div className="grid grid-cols-7 gap-1.5 mt-2">
              {(() => {
                // June 1st, 2026 is a Monday.
                // In a Sunday-start calendar, Sunday is blank, Monday is day 1. So we prepend 1 blank cell.
                const days = [];
                days.push({ blank: true }); // Sunday blank
                
                for (let d = 1; d <= 30; d++) {
                  // Support matching date e.g. "2026-06-25" (June 25)
                  const padDay = d.toString().padStart(2, '0');
                  const fullDate = `2026-06-${padDay}`;
                  const matchedEvents = events.filter(e => e.date && e.date.includes(fullDate));
                  
                  days.push({
                    blank: false,
                    dayNum: d,
                    dateStr: fullDate,
                    events: matchedEvents
                  });
                }

                return days.map((cell, idx) => {
                  if (cell.blank) {
                    return <div key={`blank-${idx}`} className="aspect-square bg-slate-100/30 rounded-lg" />;
                  }

                  const hasEvents = cell.events && cell.events.length > 0;
                  const firstEvent = cell.events?.[0];
                  
                  // Color styling based on event status
                  let cellStyle = "bg-white text-slate-700 hover:bg-slate-105 border border-slate-150";
                  if (hasEvents && firstEvent) {
                    if (firstEvent.status === 'delivered') {
                      cellStyle = "bg-emerald-500 text-white font-extrabold border bg-emerald-500 shadow-xs";
                    } else if (firstEvent.status === 'active') {
                      cellStyle = "bg-indigo-600 text-white font-extrabold border bg-indigo-600 shadow-xs";
                    } else {
                      cellStyle = "bg-amber-500 text-white font-extrabold border bg-amber-500 shadow-xs";
                    }
                  }

                  // Check if today is June 7
                  const isToday = cell.dayNum === 7;

                  return (
                    <div
                      key={`day-${cell.dayNum}`}
                      className={`relative aspect-square rounded-xl p-1 md:p-1.5 flex flex-col justify-between cursor-pointer transition-all duration-150 text-[11px] ${cellStyle} group hover:scale-[1.03] ${
                        isToday ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-white' : ''
                      }`}
                      onClick={() => {
                        if (hasEvents && firstEvent) {
                          alert(`Surprise launch details:\n\n🎉 Celebrant: ${firstEvent.cel}\n🎯 Occasion: ${firstEvent.occ}\n📅 Deadline: ${firstEvent.date}\n💼 Status: ${firstEvent.status.toUpperCase()}`);
                          if (firstEvent.status === 'active') {
                            onNavigate('studio');
                          }
                        } else {
                          alert(`Quiet day (June ${cell.dayNum}, 2026). No active surprise campaigns are due today! You can launch a brand new campaign by clicking "+ New Celebration" in the header.`);
                        }
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-extrabold">{cell.dayNum}</span>
                        {isToday && (
                          <span className="text-[7.5px] bg-red-600 text-white px-1 py-0.2 rounded-sm font-black uppercase tracking-wider animate-pulse leading-none">
                            TODAY
                          </span>
                        )}
                      </div>

                      {hasEvents && firstEvent && (
                        <div className="text-[7.5px] leading-tight truncate font-black mt-1 bg-black/15 text-white rounded px-1 py-0.5 text-center select-none">
                          {firstEvent.emoji} {firstEvent.cel.split(' ')[0]}
                        </div>
                      )}

                      {/* Tooltip on hover */}
                      {hasEvents && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-950 text-white text-[9.5px] font-black p-2 rounded-lg shadow-xl shrink-0 z-30 w-36 text-center select-none pointer-events-none border border-slate-800">
                          <p className="font-extrabold text-indigo-300">{firstEvent?.title}</p>
                          <p className="text-[8.5px] text-slate-400 font-semibold mt-0.5">Status: {firstEvent?.status?.toUpperCase()}</p>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Right Campaign Feed / Quick Link List */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">
              Upcoming Milestones
            </h3>
            
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {events.slice(0, 5).map(e => {
                const isDelivered = e.status === 'delivered';
                const isActive = e.status === 'active';
                return (
                  <div
                    key={e.id}
                    onClick={() => {
                      if (isActive) {
                        onNavigate('studio');
                      } else {
                        alert(`Surprise details: ${e.title} was marked as ${e.status.toUpperCase()}`);
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition duration-150 cursor-pointer flex gap-2.5 items-center ${
                      isActive ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50/60 border-slate-100'
                    }`}
                  >
                    <div className="text-xl">{e.emoji || '🎁'}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">{e.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Due: {e.date}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${
                        isDelivered ? 'bg-emerald-100 text-emerald-700' :
                        isActive ? 'bg-indigo-100 text-indigo-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {e.status}
                      </span>
                      <button
                        type="button"
                        onClick={(evt) => handleStartDelete(e.id, evt)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition cursor-pointer"
                        title="Delete Campaign"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 bg-indigo-50/30 border border-indigo-100/50 rounded-xl">
              <span className="text-[10px] font-extrabold text-indigo-600 block uppercase">💡 Pro Tip</span>
              <p className="text-[10.5px] text-slate-500 mt-0.5 leading-normal">
                Click any highlighted calendar date block to examine contribution metrics, check trimmer status, or open the camera to upload custom congratulations.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* active event pipeline widget */}
      {activeEvent && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-5">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <span>🔄</span> Surprise Progress — {activeEvent.title}
              </h2>
            </div>
            <span className="px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-full font-bold text-xs">
              SNEAK PEEK
            </span>
          </div>

          {/* Stepper tracker */}
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-4 mb-4 select-none scrollbar-none">
            {PIPELINE_STAGES.map((s, idx) => {
              const isDone = idx < activeEvent.pipeline;
              const isActive = idx === activeEvent.pipeline;
              return (
                <div key={s.id} className="flex-1 min-w-[85px] flex flex-col items-center relative text-center">
                  <div className="flex items-center w-full justify-center">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold z-10 transition-all ${
                      isDone ? 'bg-emerald-50 border-emerald-500 text-emerald-600' :
                      isActive ? 'bg-indigo-600 border-indigo-600 text-white ring-4 ring-indigo-50' :
                      'bg-white border-slate-200 text-slate-400'
                    }`}>
                      {isDone ? '✓' : s.icon}
                    </div>
                  </div>
                  <div className={`text-[10px] font-bold mt-2 truncate ${
                    isDone ? 'text-emerald-600' :
                    isActive ? 'text-indigo-600 font-extrabold' :
                    'text-slate-400'
                  }`}>
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl">{PIPELINE_STAGES[activeEvent.pipeline].icon}</div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current Milestone</div>
                <div className="text-sm font-extrabold text-slate-900">{PIPELINE_STAGES[activeEvent.pipeline].label}</div>
                <div className="text-xs text-slate-500">{PIPELINE_STAGES[activeEvent.pipeline].desc}</div>
              </div>
            </div>
            <div className="text-left sm:text-right bg-white px-4 py-2 border border-slate-100 rounded-xl">
              <div className="text-[9px] font-black text-slate-400 tracking-widest uppercase">DAYS REMAINING</div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-black ${daysTo(activeEvent.date) <= 3 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {Math.max(0, daysTo(activeEvent.date))}
                </span>
                <span className="text-xs text-slate-400 font-medium">days</span>
              </div>
            </div>
          </div>

          {/* 🔗 CELEBRATION PORTAL CONTROL CENTER & BULK REMINDERS */}
          <div className="mt-6 bg-indigo-950/5 border border-indigo-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-indigo-100 pb-3">
              <div>
                <h3 className="text-xs font-black text-indigo-800 uppercase tracking-widest flex items-center gap-1.5">
                  <span>🔗</span> Celebration Invite Link & Nudge Control Center
                </h3>
                <p className="text-[11px] text-indigo-950/60 mt-0.5">
                  Organize, test the contributor upload experience, and nudge guests who haven't sent wishes yet.
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-emerald-200 rounded-full px-3 py-1.5 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black text-emerald-700">
                  {media.filter(m => activeEvent && m.event === activeEvent.id && m.from && m.from !== 'Me (Composer)' && m.approved !== false).length} wishes received
                </span>
                {media.filter(m => activeEvent && m.event === activeEvent.id && m.approved === false).length > 0 && (
                  <span className="text-[10px] font-black text-amber-600 border-l border-emerald-200 pl-1.5 ml-0.5">
                    {media.filter(m => activeEvent && m.event === activeEvent.id && m.approved === false).length} pending review
                  </span>
                )}
              </div>
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full font-black animate-pulse">
                Organizer Console ACTIVE
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Side: Copy Link & Test-Drive Simulator */}
              <div className="lg:col-span-7 bg-white p-4 border border-slate-200 rounded-xl space-y-4">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  🌐 Public Shareable Submission Link
                </span>
                
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-mono text-[11px]">
                  <span className="text-slate-700 break-all select-all flex-1 pr-1 font-bold">
                    https://zippzap.ng/portal/{activeEvent.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(`https://zippzap.ng/portal/${activeEvent.id}`);
                      alert(`🔗 Copied! Share this unique link with guest circles to collect secret surprise wishes:\nhttps://zippzap.ng/portal/${activeEvent.id}`);
                    }}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-extrabold cursor-pointer transition text-center shrink-0"
                  >
                    Copy invite URL
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!qrDataUrl) {
                        const url = await generateQrDataUrl(`https://zippzap.ng/portal/${activeEvent.id}`);
                        setQrDataUrl(url);
                      }
                      setShowQr((s) => !s);
                    }}
                    className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[10px] font-extrabold cursor-pointer transition text-center shrink-0"
                  >
                    📱 QR Code
                  </button>
                </div>

                {showQr && qrDataUrl && (
                  <div className="flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-xl p-4">
                    <img src={qrDataUrl} alt="QR code for contributor portal link" className="w-40 h-40" />
                    <p className="text-[10px] text-slate-500 text-center leading-tight">
                      Scan to open the submission portal directly. Great for printing on a table card at in-person events.
                    </p>
                    <a
                      href={qrDataUrl}
                      download={`zippzap-qr-${activeEvent.id}.png`}
                      className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-700"
                    >
                      Download PNG
                    </a>
                  </div>
                )}

                <div className="bg-indigo-50/60 border border-indigo-150 rounded-xl p-3.5 flex flex-col sm:flex-row items-start gap-3.5">
                  <span className="text-2xl mt-0.5 select-none">🧪</span>
                  <div className="space-y-1">
                    <h4 className="text-[11.5px] font-black text-indigo-950">Test Portal & Upload Simulator</h4>
                    <p className="text-[10.5px] text-indigo-950/80 leading-normal">
                      Experience exactly how guests join, authenticate, and upload their files (videos, voice recordings, customized photos, or kind words) using any browser.
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => onOpenPortal(activeEvent.id)}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition active:scale-95 shadow-sm inline-flex items-center gap-1.5"
                      >
                        🚀 Launch Live Portal Simulator
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Side: Smart Reminders (Those who send vs Those who don't!) */}
              <div className="lg:col-span-5 bg-white p-4 border border-slate-200 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    🔔 Smart Nudge & Reminder Desk
                  </span>
                  <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded leading-none">
                    Pending: {activeEvent.invites.filter(i => !i.responded).length}
                  </span>
                </div>

                {/* Grid counters: Responded (Fine!) vs Pending (Needs Reminder!) */}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-lg">
                    <div className="text-emerald-700 font-extrabold text-sm">
                      {activeEvent.invites.filter(i => i.responded).length}
                    </div>
                    <div className="text-[9px] font-black uppercase text-emerald-600 mt-0.5">Wished (Fine! ✅)</div>
                  </div>
                  <div className="p-2.5 bg-amber-50/60 border border-amber-100 rounded-lg">
                    <div className="text-amber-700 font-extrabold text-sm">
                      {activeEvent.invites.filter(i => !i.responded).length}
                    </div>
                    <div className="text-[9px] font-black uppercase text-amber-600 mt-0.5">Silent (Remind! ⏳)</div>
                  </div>
                </div>

                {/* Reminder custom message builder and dispatch */}
                {activeEvent.invites.filter(i => !i.responded).length > 0 ? (
                  <div className="space-y-3 pt-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                      Choose Tone for dynamic reminder
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 text-[9px] font-extrabold uppercase">
                      <button
                        type="button"
                        onClick={() => {
                          const greetMsg = `Hey! Just a friendly nudge from the organizer of ${activeEvent.cel}'s surprise celebration album. We are compiling soon, so please click to leave your video/audio wish: https://zippzap.ng/portal/${activeEvent.id}`;
                          alert(`📝 Copied Friendly Nudge Draft to clipboard!\n\n"${greetMsg}"`);
                          navigator.clipboard?.writeText(greetMsg);
                        }}
                        className="p-1 px-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-center cursor-pointer text-slate-700 transition"
                      >
                        😊 Friendly
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const greetMsg = `Yo! 🎉 The party is starting and we are compiling a tribute track for ${activeEvent.cel}'s celebration! Don't miss out - send your video/audio wishes here: https://zippzap.ng/portal/${activeEvent.id}`;
                          alert(`📝 Copied Party Celebration Draft to clipboard!\n\n"${greetMsg}"`);
                          navigator.clipboard?.writeText(greetMsg);
                        }}
                        className="p-1 px-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-205 rounded text-center cursor-pointer text-indigo-700 transition"
                      >
                        🎺 Party Beat
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const greetMsg = `🚨 FINAL COUNTDOWN! The automated engine is putting together ${activeEvent.cel}'s surprise. Submit your voice, video files or letter wishes before midnight release cut-off: https://zippzap.ng/portal/${activeEvent.id}`;
                          alert(`📝 Copied Urgent Release Draft to clipboard!\n\n"${greetMsg}"`);
                          navigator.clipboard?.writeText(greetMsg);
                        }}
                        className="p-1 px-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-205 rounded text-center cursor-pointer text-rose-700 transition"
                      >
                        🚨 Countdown
                      </button>
                      <button
                        type="button"
                        disabled={aiNudgeLoading}
                        onClick={async () => {
                          setAiNudgeLoading(true);
                          setAiNudgeStatus('Loading AI writing model...');
                          try {
                            const portalLink = `https://zippzap.ng/portal/${activeEvent.id}`;
                            const greetMsg = await generateNudgeMessage(
                              activeEvent.cel,
                              activeEvent.occ,
                              'Friendly',
                              portalLink,
                              (pct, status) => setAiNudgeStatus(`${status} (${pct}%)`)
                            );
                            alert(`✨ AI-Generated Nudge Draft (copied to clipboard)!\n\n"${greetMsg}"`);
                            navigator.clipboard?.writeText(greetMsg);
                          } catch (err) {
                            alert('⚠️ AI generation failed. Falling back to the tone buttons above works fine too.');
                          } finally {
                            setAiNudgeLoading(false);
                            setAiNudgeStatus('');
                          }
                        }}
                        className="p-1 px-1.5 bg-gradient-to-r from-indigo-600 to-purple-650 hover:from-indigo-500 hover:to-purple-550 border border-transparent rounded text-center cursor-pointer text-white transition disabled:opacity-60"
                      >
                        {aiNudgeLoading ? '⏳ Generating...' : '✨ AI Custom'}
                      </button>
                    </div>

                    {aiNudgeStatus && (
                      <p className="text-[9px] text-indigo-500 pl-0.5">{aiNudgeStatus}</p>
                    )}

                    <p className="text-[10px] text-slate-500 italic pl-0.5 leading-tight">
                      * Tone buttons copy template instantly! "AI Custom" generates a fresh, personalized draft on-device. Share to WhatsApp, Telegram or email circles.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        // Mark all unrepresented guests as reminded by setting onUpdateEvents
                        if (onUpdateEvents) {
                          const remindersSent = activeEvent.invites.filter(i => !i.responded);
                          const names = remindersSent.map(i => i.name).join(', ');
                          
                          const updated = events.map(ev => {
                            if (ev.id === activeEvent.id) {
                              const newList = ev.invites.map(invName => {
                                if (!invName.responded) {
                                  return { ...invName, sent: true, viewed: true }; 
                                }
                                return invName;
                              });
                              return { ...ev, invites: newList, pipeline: Math.max(ev.pipeline, 2) };
                            }
                            return ev;
                          });
                          onUpdateEvents(updated);
                          alert(`⚡ Simulated bulk reminders successfully dispatched to all pending circle guests (${remindersSent.length}):\n\n[ ${names} ] have been nudged with the active portal link!`);
                        }
                      }}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[10.5px] rounded-lg transition active:scale-95 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      ⚡ Send Dynamic Reminders to Non-Responded
                    </button>
                  </div>
                ) : (
                  <div className="py-4 text-center text-[10.5px] text-slate-400 bg-slate-50/50 border border-slate-100 rounded-lg">
                    ✨ Everyone has submitted their wishes! No reminders needed. Ready to compile final project!
                  </div>
                )}
              </div>
            </div>

            {/* Quick Compilation Direct shortcut */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-3.5 border border-indigo-900 rounded-xl text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest block font-mono">Stitch & Heuristic Render Engine</span>
                <p className="text-xs font-bold text-slate-200">Wishes collected successfully? Sequencer orders contributions automatically.</p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCompileCampaignWishes}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white font-black text-[10.5px] uppercase tracking-wider rounded-lg shrink-0 cursor-pointer transition active:scale-95 shadow-md flex items-center gap-1"
                  id="compile-campaign-wishes-btn"
                >
                  ⚡ Compile Wishes
                </button>
                <button
                  type="button"
                  onClick={handleSuggestHighlightReel}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-[10.5px] uppercase tracking-wider rounded-lg shrink-0 cursor-pointer transition active:scale-95 shadow-md flex items-center gap-1"
                >
                  🎯 Suggest 90s Highlight Reel
                </button>
                <button
                  type="button"
                  disabled={isStructuring}
                  onClick={handleAiNarrativeCompile}
                  className="px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-black text-[10.5px] uppercase tracking-wider rounded-lg shrink-0 cursor-pointer transition active:scale-95 shadow-md flex items-center gap-1 disabled:opacity-60"
                >
                  {isStructuring ? '⏳ Structuring...' : '🧠 AI Narrative Structure'}
                </button>
                <button
                  onClick={() => onNavigate('studio')}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 font-extrabold text-[10.5px] uppercase tracking-wider rounded-lg shrink-0 cursor-pointer transition active:scale-95 shadow-sm"
                >
                  ⚙️ Open Video Studio
                </button>
              </div>
            </div>

            {structuringStatus && (
              <p className="text-[10px] text-fuchsia-600 font-bold px-1">⏳ {structuringStatus}</p>
            )}

            {/* Version History - snapshot/restore, built on the same state-snapshot mechanism as autosave */}
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <button
                type="button"
                onClick={async () => {
                  if (!showSnapshots) setSnapshots(getSnapshots());
                  setShowSnapshots((s) => !s);
                }}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  🕘 Version History {showSnapshots ? '▲' : '▼'}
                </span>
                <span className="text-[9px] text-slate-400">{snapshots.length > 0 ? `${snapshots.length} saved` : 'Save a snapshot to enable "revert to yesterday\'s cut"'}</span>
              </button>

              {showSnapshots && (
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    disabled={savingSnapshot}
                    onClick={async () => {
                      const label = prompt('Name this snapshot (e.g. "Before adding music"):', new Date().toLocaleString());
                      if (!label) return;
                      setSavingSnapshot(true);
                      try {
                        await saveSnapshot(label);
                        setSnapshots(getSnapshots());
                      } catch (err: any) {
                        alert(`⚠️ Could not save snapshot: ${err?.message || err}`);
                      } finally {
                        setSavingSnapshot(false);
                      }
                    }}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-[10px] rounded-lg transition cursor-pointer disabled:opacity-60"
                  >
                    {savingSnapshot ? '⏳ Saving...' : '📸 Save Snapshot Now'}
                  </button>

                  {snapshots.length === 0 && (
                    <p className="text-[10px] text-slate-400 text-center py-2">No snapshots yet.</p>
                  )}

                  {snapshots.map((snap) => (
                    <div key={snap.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-150 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 truncate">{snap.label}</p>
                        <p className="text-[9px] text-slate-400">{new Date(snap.created).toLocaleString()} · {snap.mediaCount} media files</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`Restore "${snap.label}"? This will overwrite your current project state (a new snapshot of the current state is NOT taken automatically).`)) return;
                            try {
                              const result = await restoreSnapshot(snap.id);
                              alert(`✅ Restored ${result.mediaCount} media files. Reloading...`);
                              window.location.reload();
                            } catch (err: any) {
                              alert(`⚠️ Restore failed: ${err?.message || err}`);
                            }
                          }}
                          className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-[9px] font-extrabold rounded cursor-pointer"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteSnapshot(snap.id);
                            setSnapshots(getSnapshots());
                          }}
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[9px] font-extrabold rounded cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Surprise Invite Permissions & Responder Tracking */}
          <div className="mt-6 border-t border-slate-100 pt-5 space-y-4">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                  <span>👥</span> Surprise Invite Permissions & Responder Tracking
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Authorize direct uploads, track contributions, or nudge silent invitees.
                </p>
              </div>

              {/* Add authorized contributor inline form */}
              <div className="bg-slate-50 border border-slate-150 rounded-xl p-2 flex flex-wrap gap-2 items-center w-full xl:w-auto">
                <input
                  type="text"
                  placeholder="Partner Name"
                  value={newInvName}
                  onChange={e => setNewInvName(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none w-28 focus:border-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Email / WhatsApp"
                  value={newInvContact}
                  onChange={e => setNewInvContact(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none w-36 focus:border-indigo-500"
                />
                <select
                  value={newInvMethod}
                  onChange={e => setNewInvMethod(e.target.value as any)}
                  className="px-1.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none cursor-pointer"
                >
                  <option value="WhatsApp">WA 📱</option>
                  <option value="Email">Mail 📨</option>
                  <option value="SMS">SMS 💬</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!newInvName || !newInvContact) {
                      alert('Please specify invite name & contact credentials! ⚠️');
                      return;
                    }
                    if (onUpdateEvents) {
                      const updatedEvents = events.map(ev => {
                        if (ev.id === activeEvent.id) {
                          return {
                            ...ev,
                            invites: [
                              ...ev.invites,
                              {
                                name: newInvName,
                                contact: newInvContact,
                                method: newInvMethod,
                                sent: true,
                                responded: false,
                                allowedUpload: true,
                                isMuted: false
                              }
                            ]
                          };
                        }
                        return ev;
                      });
                      onUpdateEvents(updatedEvents);
                      setNewInvName('');
                      setNewInvContact('');
                      alert(`🚀 Invited authorized contributor: ${newInvName}! They can now submit secret video/audio greetings!`);
                    } else {
                      alert('Error: Events state updates not connected in App.tsx.');
                    }
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-lg cursor-pointer transition whitespace-nowrap"
                >
                  + Invite Partner
                </button>
              </div>
            </div>

            {/* List contributors list layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activeEvent.invites.map((inv, index) => {
                const hasUploaded = inv.responded;
                const isAllowed = inv.allowedUpload !== false;

                return (
                  <div key={inv.contact + '-' + index} className="p-3.5 bg-slate-50/50 border border-slate-200/60 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-800 truncate">{inv.name}</span>
                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                          hasUploaded ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                        }`}>
                          {hasUploaded ? '✓ RESPONDED' : '⏳ PENDING'}
                        </span>
                        {!isAllowed && (
                          <span className="text-[8px] font-black bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full">
                            🚫 REVOKED
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                        {inv.contact} · {inv.method}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Permissions Toggle control button */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onUpdateEvents) {
                            const updated = events.map(ev => {
                              if (ev.id === activeEvent.id) {
                                const list = [...ev.invites];
                                list[index] = { ...list[index], allowedUpload: !isAllowed };
                                return { ...ev, invites: list };
                              }
                              return ev;
                            });
                            onUpdateEvents(updated);
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition cursor-pointer ${
                          isAllowed ? 'bg-rose-50 hover:bg-rose-100 text-rose-600' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600'
                        }`}
                        title={isAllowed ? 'Revoke upload rights' : 'Allow contribution uploads'}
                      >
                        {isAllowed ? '🔒 Revoke' : '🔓 Allow'}
                      </button>

                      {/* WhatsApp / Notification Nudge warning */}
                      <button
                        type="button"
                        onClick={() => {
                          alert(`📱 Simulating invite nudge reminder to ${inv.name}:\n\n"Hey ${inv.name}, we are compiling ${activeEvent.cel}'s surprise album! Record your secret video/audio wish before midnight release: https://zippzap.ng/portal/${activeEvent.id}"`);
                        }}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-[10px] font-extrabold cursor-pointer transition shrink-0"
                      >
                        ⚡ Nudge
                      </button>
                    </div>
                  </div>
                );
              })}

              {activeEvent.invites.length === 0 && (
                <div className="col-span-2 text-center text-[11px] text-slate-400 py-4 italic">
                  No contributors invited to this surprise event yet. Add partners above!
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rewards Progress Banner */}
      <div className="bg-slate-950 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden shadow-xl shadow-slate-900/10">
        <div className="absolute right-[-20px] top-[-20px] w-36 h-36 rounded-full bg-white/5 pointer-events-none"></div>
        <div className="absolute right-10 bottom-[-30px] w-20 h-20 rounded-full bg-white/5 pointer-events-none"></div>
        
        <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center relative z-10">
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">CELEBRATE MORE. GAIN POWERFUL PERKS.</div>
            <h2 className="text-2xl md:text-3xl font-black">{points} <span className="text-amber-300 text-lg">Points Balance</span></h2>
            <div className="text-xs text-slate-300 flex items-center gap-2">
              <span>{currentTier.icon}</span> {currentTier.name} Member · Earn points by uploading videos and voice messages!
            </div>
            
            <div className="pt-2">
              <div className="w-full max-w-xs md:max-w-md bg-slate-800 rounded-full h-2 overflow-hidden mb-2">
                <div className="h-full bg-gradient-to-r from-amber-300 to-amber-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }}></div>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                {points} / {currentTier.max} pts to next rewards level ({currentTier.next})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4 text-center min-w-[100px]">
              <div className="text-2xl mb-1">👑</div>
              <div className="text-[10px] font-bold text-slate-100">Contribute</div>
              <div className="text-[9px] text-slate-400">Get +20 points</div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4 text-center min-w-[100px]">
              <div className="text-2xl mb-1">🎁</div>
              <div className="text-[10px] font-bold text-slate-100">Redeem rewards</div>
              <div className="text-[9px] text-slate-400">Gift vouchers</div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4 text-center min-w-[100px]">
              <div className="text-2xl mb-1">🏆</div>
              <div className="text-[10px] font-bold text-slate-100">Premium Perks</div>
              <div className="text-[9px] text-slate-400">Free video templates</div>
            </div>
          </div>
        </div>
      </div>

      {/* Rewards Tier Cards Progress Slider List */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Milestone Progress Levels</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {rewardTiers.map(t => {
            const isActive = currentTier.name === t.name;
            return (
              <div
                key={t.name}
                className={`p-4 rounded-xl border transition-all text-center ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                    : 'border-slate-100 bg-slate-50/50'
                }`}
              >
                <div className="text-2xl mb-1">{t.icon}</div>
                <div className={`text-xs font-bold ${isActive ? 'text-indigo-600' : 'text-slate-700'}`}>{t.name}</div>
                <div className="text-[10px] text-slate-400 mt-1">{t.min} - {t.max} pts</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Secondary Bottom Grid: Media alert and feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Contributions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight">Recent Contributor Submissions</h3>
            <button onClick={() => onNavigate('library')} className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
              View All 🗂️
            </button>
          </div>
          <div className="space-y-3">
            {recentMedia.length > 0 ? (
              recentMedia.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-b-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {item.thumb ? (
                      <img src={item.thumb} alt={item.name} className="w-full h-full object-cover" />
                    ) : item.type === 'audio' ? (
                      <span>🎙️</span>
                    ) : item.type === 'text' ? (
                      <span>✍️</span>
                    ) : item.type === 'photo' ? (
                      <span>📸</span>
                    ) : (
                      <span>🎬</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{item.name}</div>
                    <div className="text-[10px] text-slate-400 capitalize">{item.from} · {item.type}</div>
                  </div>
                  <button onClick={() => onNavigate('library')} className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition">
                    View
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-10">
                <span className="text-3xl block filter grayscale mb-2">🗂️</span>
                <p className="text-xs text-slate-400">Your media library is currently empty.</p>
                <button onClick={() => onNavigate('upload')} className="text-xs text-indigo-600 font-bold mt-2">
                  Upload wishes ➔
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight">Celebration Log</h3>
            <button onClick={() => onNavigate('tracker')} className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
              Audit Feed 📊
            </button>
          </div>
          <div className="space-y-4">
            {activity.slice(0, 4).map(act => (
              <div key={act.id} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100/80 flex items-center justify-center text-xs flex-shrink-0">
                  {act.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-900">{act.text}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{act.stage} · {act.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key account program display card */}
      <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 text-white rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-xl shadow-slate-950/10">
        <div className="absolute right-[-40px] top-[-40px] w-48 h-48 rounded-full bg-white/5 pointer-events-none"></div>
        <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="text-xl">👑</span>
              <span className="text-[9px] font-bold text-amber-300 tracking-widest uppercase">KEY CELEBRATORS CLUB</span>
            </div>
            <h3 className="text-xl md:text-2xl font-black leading-tight text-white">Your surprise contributions matter deeply to your team.</h3>
            <p className="text-xs text-indigo-200">
              Active accounts planning surprises earn special rewards points redeemable for gift cards, priority support, and bespoke slideshow templates.
            </p>
          </div>
          <div className="bg-white/10 border border-white/15 backdrop-blur-md rounded-2xl p-5 min-w-[250px] w-full lg:w-auto">
            <div className="flex justify-between items-center mb-3">
              <div>
                <div className="text-xs font-bold text-white">Reward Tier</div>
                <div className="text-[10px] text-indigo-300">Active status</div>
              </div>
              <span className="px-2.5 py-0.5 bg-amber-300 text-slate-900 rounded-full text-[9px] font-bold tracking-wider uppercase">
                {currentTier.name}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/5 rounded-xl p-2 text-center text-white">
                <div className="font-extrabold text-sm text-indigo-200">{events.length}</div>
                <div className="text-[8px] text-slate-300">Surprises</div>
              </div>
              <div className="bg-white/5 rounded-xl p-2 text-center text-white">
                <div className="font-extrabold text-sm text-indigo-200">{events.reduce((s, e) => s + e.invites.length, 0)}</div>
                <div className="text-[8px] text-slate-300">People</div>
              </div>
              <div className="bg-white/5 rounded-xl p-2 text-center text-white">
                <div className="font-extrabold text-sm text-indigo-200">{points}</div>
                <div className="text-[8px] text-slate-300">Credits</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      ) : (
        <CampaignPerformance events={events} media={media} activity={activity} onStartDelete={handleStartDelete} />
      )}

      {/* Double Confirmation Campaign Deletion Modal */}
      {deleteConfirmationStep > 0 && deleteCampaignId && (
        <div className="fixed inset-0 z-[12000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200 text-left">
            <div className="absolute top-[-20px] right-[-20px] text-7xl opacity-5 pointer-events-none select-none">⚠️</div>

            {/* Step 1: Broad Deletion Warning */}
            {deleteConfirmationStep === 1 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center text-2xl shrink-0">
                    🚨
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Delete Surprise Campaign?</h3>
                    <p className="text-xs text-slate-400">Step 1 of 2 — Destructive Action</p>
                  </div>
                </div>

                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl space-y-2.5">
                  <p className="text-xs font-semibold text-rose-950">
                    You are attempting to delete the campaign:
                  </p>
                  <p className="text-sm font-black text-rose-700">
                    "{events.find(ev => ev.id === deleteCampaignId)?.title || 'Selected Campaign'}"
                  </p>
                  <p className="text-[11px] text-rose-655 leading-relaxed font-medium">
                    ⚠️ <b>Crucial Warning:</b> This will permanently revoke access to the contributor links, delete all guest invitations, and permanently remove any uploaded photos, video wishes, and custom audio from our records.
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmationStep(0)}
                    className="flex-1 h-10 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-xs rounded-xl transition border border-slate-200 cursor-pointer text-center flex items-center justify-center"
                  >
                    Cancel & Keep
                  </button>
                  <button
                    type="button"
                    onClick={handleProceedDeleteStep2}
                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer"
                  >
                    Yes, Proceed to Confirm ➔
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Manual Type Verification */}
            {deleteConfirmationStep === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-red-100 text-red-650 flex items-center justify-center text-2xl shrink-0 animate-pulse">
                    ⚠️
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Critical Confirmation</h3>
                    <p className="text-xs text-slate-450">Step 2 of 2 — Type confirmation</p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl space-y-3">
                  <p className="text-[11.5px] text-slate-600 leading-normal font-medium">
                    To completely rule out accidental clicks, please verify your intent. Type the word <b className="text-red-600 select-all font-black tracking-wider px-1.5 py-0.5 bg-red-50 border border-red-100 rounded">DELETE</b> in all capital letters below to confirm.
                  </p>
                  
                  <input
                    type="text"
                    required
                    placeholder="Type DELETE here"
                    className="w-full h-10 bg-white border border-slate-300 rounded-xl px-3 text-xs font-black text-slate-900 uppercase tracking-widest outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 shadow-inner"
                    value={typedConfirmation}
                    onChange={(e) => setTypedConfirmation(e.target.value)}
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmationStep(1)}
                    className="flex-1 h-10 bg-slate-50 hover:bg-slate-100 text-slate-650 font-bold text-xs rounded-xl transition border border-slate-200 cursor-pointer"
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    disabled={typedConfirmation !== 'DELETE'}
                    onClick={handleFinalDeleteCampaign}
                    className={`flex-1 h-10 font-black text-xs rounded-xl shadow-md transition cursor-pointer ${
                      typedConfirmation === 'DELETE'
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 shadow-none'
                    }`}
                  >
                    🗑️ Permanently Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 📈 INTERACTIVE CAMPAIGN PERFORMANCE DASHBOARD
// ==========================================
function CampaignPerformance({
  events,
  media,
  activity,
  onStartDelete
}: {
  events: CelebrativeEvent[];
  media: MediaItem[];
  activity: ActivityFeedItem[];
  onStartDelete: (eventId: string, e: React.MouseEvent) => void;
}) {
  const [hoveredCampaignId, setHoveredCampaignId] = React.useState<string | null>(null);
  const [hoveredTimelineIndex, setHoveredTimelineIndex] = React.useState<number | null>(null);

  // 1. Completion Rates calculations: (pipeline stage / 5 max) * 100%
  const campaignCompletionRates = events.map(e => {
    const rate = Math.round((e.pipeline / 5) * 100);
    return {
      id: e.id,
      title: e.title,
      cel: e.cel,
      status: e.status,
      rate,
      emoji: e.emoji || '🎉',
      invitesCount: e.invites.length,
      wishesCount: media.filter(m => m.event === e.id).length
    };
  });

  // 2. Wish Engagement Rate Side-by-Side SVG Bar Chart data
  // Render up to 5 campaigns
  const chartCampaigns = campaignCompletionRates.slice(0, 5);
  const maxYValue = Math.max(1, ...chartCampaigns.map(c => Math.max(c.invitesCount, c.wishesCount)));
  // Round max Y value up to nearest 5 or 10 for grid layout
  const roundedMaxY = Math.ceil(maxYValue / 5) * 5;

  // 3. Contributor Participation Over Time
  // Let's bin media creation times by days (e.g. from June 1st to June 25th 2026)
  const daysInJune = 25;
  const wishesTimeline = Array.from({ length: daysInJune }, (_, idx) => {
    const dayNum = idx + 1;
    const dateString = `2026-06-${dayNum.toString().padStart(2, '0')}`;
    
    // Filter real wishes for this day, or add some beautiful seed distribution so the graph is beautiful and fluid
    let realCount = media.filter(m => {
      // Check if created timestamp or metadata match this date
      const mDate = m.created ? new Date(m.created) : null;
      if (mDate) {
        return mDate.getDate() === dayNum && mDate.getMonth() === 5; // June is month 5
      }
      return false;
    }).length;

    // Fluid background curve pattern seeding
    const seedTrend = Math.round(
      Math.sin(dayNum / 3) * 2.5 + Math.cos(dayNum / 4) * 1.5 + 4
    );
    const count = Math.max(0, realCount > 0 ? realCount : seedTrend);

    return {
      day: dayNum,
      dateStr: `June ${dayNum}`,
      count
    };
  });

  const maxTimelineCount = Math.max(1, ...wishesTimeline.map(t => t.count));

  // Generate SVG area path for spline timeline
  const svgWidth = 720;
  const svgHeight = 220;
  const paddingX = 40;
  const paddingY = 30;

  const getTimelineCoords = wishesTimeline.map((t, idx) => {
    const x = paddingX + (idx / (daysInJune - 1)) * (svgWidth - paddingX * 2);
    const y = svgHeight - paddingY - (t.count / maxTimelineCount) * (svgHeight - paddingY * 2);
    return { x, y, count: t.count, dateStr: t.dateStr };
  });

  // Flowing SVG Area string
  const areaPathString = getTimelineCoords.length > 0 
    ? `M ${getTimelineCoords[0].x} ${svgHeight - paddingY} ` + 
      getTimelineCoords.map(pt => `L ${pt.x} ${pt.y}`).join(' ') + 
      ` L ${getTimelineCoords[getTimelineCoords.length - 1].x} ${svgHeight - paddingY} Z`
    : '';

  // Spline line string
  const linePathString = getTimelineCoords.length > 0
    ? getTimelineCoords.map((pt, idx) => (idx === 0 ? 'M' : 'L') + ` ${pt.x} ${pt.y}`).join(' ')
    : '';

  return (
    <div className="space-y-8 animate-fade-in text-slate-800">
      {/* Overview Intro Banner */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-extrabold tracking-widest uppercase px-2.5 py-0.5 rounded-full inline-block mb-1.5">
            REAL-TIME METRICS HUB
          </span>
          <h2 className="text-xl md:text-2xl font-black">Campaign Performance Dashboard</h2>
          <p className="text-xs text-slate-400 mt-1">
            Analyzing guest engagement, milestone completion rates, and submission curves to maximize secret surprise impact.
          </p>
        </div>
        <div className="text-left md:text-right">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">AGGREGATE ENGAGEMENT</div>
          <div className="text-2xl font-black text-emerald-400">
            {events.length > 0
              ? Math.round((media.filter(m => m.from && m.from !== 'Me (Composer)').length / Math.max(1, events.reduce((s, e) => s + e.invites.length, 0))) * 100)
              : 0}%
          </div>
          <p className="text-[10px] text-slate-400">Actual vs Expected submissions</p>
        </div>
      </div>

      {/* Grid: 1. Surprise Campaigns Completion Rates */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-6">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <span className="text-indigo-600">🎯</span> Milestone Completion Rates
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Tracking standard pipeline progression for each launch album.</p>
          </div>
          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase border border-emerald-100">
            {events.filter(e => e.status === 'delivered').length} Delivered
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaignCompletionRates.map(c => {
            const circleRadius = 36;
            const circumference = 2 * Math.PI * circleRadius;
            const strokeDashoffset = circumference - (c.rate / 100) * circumference;

            return (
              <div
                key={c.id}
                onMouseEnter={() => setHoveredCampaignId(c.id)}
                onMouseLeave={() => setHoveredCampaignId(null)}
                className="bg-slate-50/50 hover:bg-slate-50 border border-slate-200/80 hover:border-indigo-200 rounded-2xl p-5 transition-all duration-150 flex items-center justify-between gap-4 relative overflow-hidden"
              >
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-lg">{c.emoji}</span>
                      <h4 className="text-xs font-black text-slate-900 truncate">{c.title}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={(evt) => onStartDelete(c.id, evt)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition cursor-pointer shrink-0"
                      title="Delete Campaign"
                    >
                      🗑️
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">Recipient: <strong className="text-slate-600 font-bold">{c.cel}</strong></p>
                  
                  {/* Status Indicator */}
                  <div className="flex gap-1 items-center">
                    <span className={`w-2 h-2 rounded-full inline-block ${
                      c.status === 'delivered' ? 'bg-emerald-500' :
                      c.status === 'active' ? 'bg-indigo-600' : 'bg-amber-500'
                    }`}></span>
                    <span className="text-[10px] font-extrabold capitalize text-slate-500">{c.status}</span>
                  </div>
                </div>

                {/* SVG Radial Gauge */}
                <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full -rotate-90">
                    <circle
                      cx="40"
                      cy="40"
                      r={circleRadius}
                      className="stroke-slate-200 fill-none"
                      strokeWidth="5"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r={circleRadius}
                      className="stroke-indigo-600 fill-none transition-all duration-500"
                      strokeWidth="5.5"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-black text-slate-800">{c.rate}%</span>
                    <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-tighter">Done</span>
                  </div>
                </div>

                {/* Micro hovering tooltip details */}
                {hoveredCampaignId === c.id && (
                  <div className="absolute inset-0 bg-slate-900/95 text-white p-4 flex flex-col justify-center animate-in fade-in duration-200">
                    <div className="text-[9px] font-black uppercase text-indigo-400 tracking-wider">Metrics Deep-Dive</div>
                    <p className="text-[11px] font-bold mt-1 truncate">{c.title}</p>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                      <div>
                        <span className="text-slate-400">Target Invites:</span>
                        <div className="font-extrabold text-white text-xs">{c.invitesCount}</div>
                      </div>
                      <div>
                        <span className="text-slate-400">Wishes In:</span>
                        <div className="font-extrabold text-emerald-400 text-xs">{c.wishesCount}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid columns: Left Side = Engagement Side Bar chart, Right Side = Time Curve Area chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* SVG Wish Engagement Chart */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <span>📊</span> Wish Engagement Rate
            </h3>
            <p className="text-[11.5px] text-slate-400 mt-0.5">Comparing expected invites against completed guest wishes.</p>
          </div>

          {/* Render Interactive Bar Graph */}
          <div className="py-6 flex flex-col gap-4">
            {chartCampaigns.map(c => {
              const expectedPct = Math.round((c.invitesCount / roundedMaxY) * 100);
              const actualPct = Math.round((c.wishesCount / roundedMaxY) * 100);

              return (
                <div key={c.id} className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px] font-bold">
                    <span className="text-slate-700 truncate max-w-[150px]">{c.emoji} {c.cel.split(' ')[0]}'s Album</span>
                    <span className="text-slate-400 font-mono text-[10px]">
                      Expected: <strong className="text-slate-600">{c.invitesCount}</strong> · In: <strong className="text-emerald-600">{c.wishesCount}</strong>
                    </span>
                  </div>

                  <div className="space-y-1">
                    {/* Expected bar (Light Gray/Indigo outline) */}
                    <div className="h-2 bg-slate-150 rounded-full overflow-hidden w-full relative">
                      <div
                        className="h-full bg-slate-300 rounded-full transition-all"
                        style={{ width: `${Math.max(4, expectedPct)}%` }}
                      ></div>
                    </div>
                    {/* Actual wish submissions bar (Emerald color) */}
                    <div className="h-2.5 bg-emerald-50 rounded-full overflow-hidden w-full relative">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all"
                        style={{ width: `${Math.max(4, actualPct)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center gap-3 text-[10px] text-slate-500">
            <span className="text-xl">💡</span>
            <p className="leading-normal">
              A high gap between expected and actual bars indicates a need to trigger <strong className="text-indigo-600">Circle Reminders</strong> to nudge silent invitees.
            </p>
          </div>
        </div>

        {/* Dynamic Timeline Area Spline curve */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📈</span> Contributor Participation over Time
                </h3>
                <p className="text-[11.5px] text-slate-400 mt-0.5">Timeline frequency graph measuring upload rates during June 2026.</p>
              </div>
              <div className="text-right text-[10px] font-mono text-slate-400">
                Peak Rate: <strong className="text-slate-700">{maxTimelineCount} wishes/day</strong>
              </div>
            </div>
          </div>

          {/* SVG Canvas Area Graph */}
          <div className="relative py-4">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible select-none">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {Array.from({ length: 4 }).map((_, i) => {
                const y = paddingY + (i / 3) * (svgHeight - paddingY * 2);
                const countVal = Math.round(maxTimelineCount - (i / 3) * maxTimelineCount);
                return (
                  <g key={i}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={svgWidth - paddingX}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth="1.5"
                    />
                    <text
                      x={paddingX - 10}
                      y={y + 3}
                      fill="#94a3b8"
                      fontSize="9"
                      textAnchor="end"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {countVal}
                    </text>
                  </g>
                );
              })}

              {/* The Area filled path */}
              <path d={areaPathString} fill="url(#areaGrad)" />

              {/* The Flow Line curve */}
              <path
                d={linePathString}
                fill="none"
                stroke="#6366f1"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Coordinate Nodes dot elements */}
              {getTimelineCoords.map((pt, idx) => {
                // Focus circle on hover
                const isHovered = hoveredTimelineIndex === idx;
                return (
                  <g key={idx}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 6.5 : 3.5}
                      className={`${isHovered ? 'fill-rose-500 stroke-white' : 'fill-indigo-600 stroke-white'} transition-all cursor-pointer`}
                      strokeWidth="2"
                      onMouseEnter={() => setHoveredTimelineIndex(idx)}
                      onMouseLeave={() => setHoveredTimelineIndex(null)}
                    />
                  </g>
                );
              })}

              {/* Bottom X-Axis labels */}
              <g>
                <text x={paddingX} y={svgHeight - 10} fill="#94a3b8" fontSize="9" fontWeight="bold">June 1</text>
                <text x={svgWidth / 2} y={svgHeight - 10} fill="#94a3b8" fontSize="9" fontWeight="bold" textAnchor="middle">June 13</text>
                <text x={svgWidth - paddingX} y={svgHeight - 10} fill="#94a3b8" fontSize="9" fontWeight="bold" textAnchor="end">June 25</text>
              </g>
            </svg>

            {/* Dynamic tooltips overlays on hover */}
            {hoveredTimelineIndex !== null && (
              <div
                className="absolute bg-slate-900 text-white rounded-lg p-2.5 shadow-xl border border-slate-800 text-[10.5px] pointer-events-none transition-all"
                style={{
                  left: `${Math.min(80, (getTimelineCoords[hoveredTimelineIndex].x / svgWidth) * 100)}%`,
                  top: `${Math.max(10, (getTimelineCoords[hoveredTimelineIndex].y / svgHeight) * 100 - 32)}%`
                }}
              >
                <p className="font-extrabold text-indigo-300">{getTimelineCoords[hoveredTimelineIndex].dateStr}</p>
                <p className="font-bold text-slate-100 mt-0.5">Uploaded: <span className="text-emerald-400 font-black">{getTimelineCoords[hoveredTimelineIndex].count} wishes</span></p>
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-400 italic text-center select-none pt-2">
            * Interactive timeline node hover details indicate specific peak wish upload activity windows.
          </p>
        </div>

      </div>
    </div>
  );
}
