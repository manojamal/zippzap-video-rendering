import React from 'react';
import { CelebrativeEvent } from '../types';
import { fmtD, daysTo } from '../utils';

interface ContributorHubProps {
  events: CelebrativeEvent[];
  onOpenPortal: (eventId: string) => void;
  onNavigate: (page: string) => void;
}

export default function ContributorHub({
  events,
  onOpenPortal,
  onNavigate
}: ContributorHubProps) {
  // Only show active events for contributors
  const activeEvents = events.filter(e => e.status === 'active');

  return (
    <div id="contributor-hub-container" className="space-y-8 max-w-5xl mx-auto">
      {/* Dynamic Intro Banner */}
      <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 p-8 text-8xl opacity-10 pointer-events-none select-none">🎁</div>
        <div className="max-w-xl space-y-4 relative z-10">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black bg-indigo-500/20 text-indigo-300 uppercase tracking-widest border border-indigo-500/30 font-mono">
            ✨ Guest Contributor Hub
          </span>
          <h1 className="text-xl md:text-3xl font-black tracking-tight leading-tight">
            Co-Create the Ultimate Surprise Gift
          </h1>
          <p className="text-xs md:text-sm text-slate-300 leading-relaxed font-sans">
            You've been invited to participate in a secret celebration! Choose an active campaign below to record video reactions, write emotional greeting letters, or synthesize voice messages. Everything you submit stays hidden from the celebrant until delivery day.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => onNavigate('upload')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              📤 Direct Upload Wishes
            </button>
            <button
              onClick={() => onNavigate('tts')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              🔊 TTS Wish Synthesizer
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Active Surprise Campaigns */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">
              💌 Active Secret Campaigns
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Select a campaign below to submit your gift or letter</p>
          </div>
          <span className="text-[10px] font-black text-indigo-600 uppercase bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 font-mono">
            {activeEvents.length} Campaign{activeEvents.length !== 1 ? 's' : ''} Open
          </span>
        </div>

        {activeEvents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activeEvents.map((event) => {
              const daysLeft = daysTo(event.date);
              const totalInvites = event.invites?.length || 0;
              const responded = event.invites?.filter(i => i.responded).length || 0;

              return (
                <div
                  key={event.id}
                  className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-200 flex flex-col justify-between space-y-5"
                >
                  <div className="space-y-3.5">
                    {/* Header */}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5">
                        <span className="text-3xl p-2 bg-slate-50 rounded-xl border border-slate-100 shrink-0">{event.emoji || '🎁'}</span>
                        <div>
                          <h3 className="text-sm font-bold text-slate-950 leading-snug">{event.title}</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Occasion: {event.occ}</p>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider font-mono ${
                        daysLeft > 5 ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-rose-50 text-rose-600 border border-rose-100'
                      }`}>
                        {daysLeft > 0 ? `⏰ ${daysLeft} days left` : '⏰ Today!'}
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <div>
                        <span className="text-[8.5px] uppercase font-black text-slate-400 block tracking-wide">Honored Guest</span>
                        <span className="text-xs font-bold text-slate-700 truncate block mt-0.5">{event.cel}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] uppercase font-black text-slate-400 block tracking-wide">Target Date</span>
                        <span className="text-xs font-bold text-slate-700 block mt-0.5">{fmtD(event.date)}</span>
                      </div>
                    </div>

                    {/* Progress details */}
                    <div className="space-y-1.5 text-xs font-sans">
                      <div className="flex justify-between text-[10.5px] font-bold text-slate-500">
                        <span>Contribution Progress:</span>
                        <span className="font-mono text-indigo-600">{responded} of {totalInvites || 1} Friends Submitted</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200/50">
                        <div
                          className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(10, totalInvites ? (responded / totalInvites) * 100 : 30))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => onOpenPortal(event.id)}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    ✍️ Enter Secret Portal & Submit Wish
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3 max-w-xl mx-auto">
            <span className="text-4xl block">💤</span>
            <h3 className="text-sm font-bold text-slate-800">No active secret campaigns listed</h3>
            <p className="text-xs text-slate-400 font-sans max-w-sm mx-auto">
              There are no active surprise events awaiting contributions right now. Ask your group organizer to create a campaign!
            </p>
          </div>
        )}
      </div>

      {/* Role Segregation Explanation / Restriction Alert Area */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4">
        <div className="flex gap-3 items-start">
          <span className="text-2xl mt-0.5">🔒</span>
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase text-slate-800 tracking-wider">
              Contributor Access Boundaries (Security Policy)
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed font-sans">
              To keep the surprise campaign safe and secure, certain administrative controls are hidden or disabled while you are in <strong>Contributor Mode</strong>. Below is the list of arrangements of what you can access versus what is restricted to organizers.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Accessible areas */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 space-y-2">
            <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest flex items-center gap-1.5">
              🟢 Accessible by Contributors
            </h4>
            <ul className="text-[11px] text-slate-600 space-y-1.5 font-sans">
              <li className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span> Choose Active Campaigns & Surprise lists
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span> Upload photos, videos or write letters
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span> Record live video greetings & reactions
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-emerald-500">✓</span> Synthesize wishes with Text-to-Speech (TTS)
              </li>
            </ul>
          </div>

          {/* Restricted areas */}
          <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-4 space-y-2">
            <h4 className="text-[10px] font-black text-rose-700 uppercase tracking-widest flex items-center gap-1.5">
              🚫 Restricted to Organizers (Locked)
            </h4>
            <ul className="text-[11px] text-slate-600 space-y-1.5 font-sans">
              <li className="flex items-center gap-1.5">
                <span className="text-rose-500">✕</span> Video stitcher timeline editor
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-rose-500">✕</span> Slideshow creator & frame designs
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-rose-500">✕</span> Surprise delivery & countdown dispatch
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-rose-500">✕</span> Manage subscription plans & billing
              </li>
            </ul>
          </div>
        </div>

        <div className="text-center pt-2">
          <p className="text-[10px] text-slate-400 italic">
            Are you the lead group organizer? Switch back to <strong>Organizer Mode</strong> in the top header at any time to edit the timeline video!
          </p>
        </div>
      </div>
    </div>
  );
}
