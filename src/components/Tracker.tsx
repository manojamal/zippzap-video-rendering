import React from 'react';
import { CelebrativeEvent, ActivityFeedItem } from '../types';
import { PIPELINE_STAGES, fmtD } from '../utils';

interface TrackerProps {
  events: CelebrativeEvent[];
  activity: ActivityFeedItem[];
}

export default function Tracker({ events, activity }: TrackerProps) {
  const activeEvent = events.find(e => e.status === 'active');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">📊 Celebration Milestones & Logs</h1>
        <p className="text-xs text-slate-500 mt-1">Audit historic timelines, contribution rates, status updates, and milestone progression</p>
      </div>

      {/* Pipeline Milestone */}
      {activeEvent && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-3">
            <span>Progress Audit: {activeEvent.title}</span>
            <span className="text-indigo-600">Active</span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-4">
            {PIPELINE_STAGES.map((s, idx) => {
              const isDone = idx < activeEvent.pipeline;
              const isActive = idx === activeEvent.pipeline;
              return (
                <div key={s.id} className="flex-1 min-w-[75px] flex flex-col items-center text-center">
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs ${
                    isDone ? 'bg-emerald-50 border-emerald-500 text-emerald-600' :
                    isActive ? 'bg-indigo-600 border-indigo-600 text-white' :
                    'bg-white border-slate-100 text-slate-400'
                  }`}>
                    {isDone ? '✓' : s.icon}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 mt-2 truncate max-w-[65px]">{s.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Bottom list structure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity feed list */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">Historic Timeline Activity logs</h3>
          
          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
            {activity.map(act => (
              <div key={act.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  {act.icon}
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900">{act.text}</div>
                  <div className="text-[10px] text-slate-400">{act.stage} · {act.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Campaign Metrics details */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                <span>🎯</span> Surprise RSVP Flow & Participant board
              </h3>
              <p className="text-[11px] text-slate-500">Live auditing of viewed/pending response invitation statuses.</p>
            </div>
            <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full font-black animate-pulse">
              REAL-TIME MAP
            </span>
          </div>

          <div className="space-y-6">
            {events.map(e => {
              const respondents = e.invites.filter(i => i.responded).length;
              const rate = e.invites.length > 0 ? Math.round((respondents / e.invites.length) * 100) : 0;
              
              // Viewed but not responded
              const viewedNoResponse = e.invites.filter(i => i.viewed && !i.responded);
              // Sent but not viewed
              const sentNotViewed = e.invites.filter(i => !i.viewed && i.sent);

              return (
                <div key={e.id} className="p-4 bg-slate-50/50 border border-slate-250 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-800">
                    <span className="flex items-center gap-1">{e.emoji} {e.title}</span>
                    <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded uppercase font-mono">{e.status}</span>
                  </div>

                  {/* Flow Mapper / Mini-Map Visual Matrix */}
                  <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-3">
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block">📊 Campaign Funnel Mini-Map</span>
                    
                    <div className="grid grid-cols-3 gap-2 text-center text-[10px] relative">
                      {/* Connection lines between steps */}
                      <div className="absolute top-4 left-[16.6%] right-[16.6%] h-0.5 bg-slate-100 -z-10" />
                      
                      <div className="space-y-1">
                        <div className="inline-flex w-7 h-7 rounded-full bg-blue-50 text-blue-600 border border-blue-200 items-center justify-center font-black">
                          {e.invites.filter(i => i.sent).length}
                        </div>
                        <p className="font-bold text-slate-700">1. Invited</p>
                        <p className="text-[8.5px] text-slate-400">Total Outgoing</p>
                      </div>

                      <div className="space-y-1 relative">
                        <div className={`inline-flex w-7 h-7 rounded-full items-center justify-center font-black ${
                          viewedNoResponse.length > 0 
                            ? 'bg-amber-100 text-amber-750 border border-amber-300 animate-bounce' 
                            : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                        }`}>
                          {e.invites.filter(i => i.viewed).length}
                        </div>
                        <p className="font-bold text-slate-700 flex items-center justify-center gap-0.5">
                          2. Viewed
                          {viewedNoResponse.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping inline-block" />}
                        </p>
                        <p className="text-[8.5px] text-slate-400">Read Receipts</p>
                      </div>

                      <div className="space-y-1">
                        <div className="inline-flex w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 items-center justify-center font-black">
                          {respondents}
                        </div>
                        <p className="font-bold text-slate-700">3. Wished ✅</p>
                        <p className="text-[8.5px] text-slate-400">Contributions</p>
                      </div>
                    </div>
                  </div>

                  {/* Highlight view-alert category */}
                  {viewedNoResponse.length > 0 && (
                    <div className="p-3.5 bg-amber-50/70 border-l-[3.5px] border-amber-500 rounded-r-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-black text-amber-800 uppercase tracking-wider flex items-center gap-1">
                          <span>⚠️</span> Viewed Invite but No Wish Submitted Yet ({viewedNoResponse.length})
                        </span>
                        <span className="text-[8.5px] bg-amber-100 text-amber-800 px-2 py-0.2 rounded font-black">NUDGE CANDIDATES</span>
                      </div>
                      <p className="text-[10px] text-amber-900/80 leading-normal">
                        These invited family members have opened and read their custom greetings, but haven't submitted their audio/video tribute clip yet. Tap draft nudge to copy a dynamic reminder message.
                      </p>

                      <div className="divide-y divide-amber-100/50 bg-white/70 border border-amber-100 rounded-xl overflow-hidden text-[11px]">
                        {viewedNoResponse.map((member, mIdx) => (
                          <div key={mIdx} className="p-2.5 flex justify-between items-center gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-500" />
                                <span className="font-black text-slate-800">{member.name}</span>
                              </div>
                              <div className="text-[9px] text-slate-400 mt-0.5">{member.contact} · {member.method} receipt</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const greetMsg = `Hey ${member.name}! Oluwaseun's surprise birthday video is compiling soon. 🎁 Saw you checked out the invite, we would absolutely love to hear/see your beautiful voice inside our memory reel! Click back to submit your clip: ${e.link}`;
                                alert(`📧 Dynamic reminder template drafted for ${member.name}:\n\n"${greetMsg}"\n\n(Tip: Message is copied to clipboard!)`);
                                navigator.clipboard.writeText(greetMsg);
                              }}
                              className="px-2 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[9.5px] rounded-lg transition cursor-pointer"
                            >
                              💬 Copy Nudge Text
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Complete status grid directory list of all members */}
                  <div className="space-y-2">
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block">📋 Complete Invitation Directory</span>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[140px] overflow-y-auto pr-1">
                      {e.invites.map((member, inviteIdx) => {
                        let badgeBg = 'bg-slate-100 text-slate-600';
                        let labelStr = 'Pending Delivery';
                        
                        if (member.responded) {
                          badgeBg = 'bg-emerald-100 text-emerald-700 font-extrabold';
                          labelStr = '✓ Wished';
                        } else if (member.viewed) {
                          badgeBg = 'bg-amber-100 text-amber-700 font-extrabold';
                          labelStr = '⚠️ Viewed';
                        } else if (member.sent) {
                          badgeBg = 'bg-indigo-100 text-indigo-700';
                          labelStr = '📨 Unread';
                        }

                        return (
                          <div key={inviteIdx} className="p-2 bg-white border border-slate-150 rounded-xl flex items-center justify-between text-[11px]">
                            <div className="min-w-0 flex-1">
                              <h5 className="font-extrabold text-slate-800 truncate">{member.name}</h5>
                              <p className="text-[8.5px] text-slate-400 truncate">{member.contact}</p>
                            </div>
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${badgeBg}`}>
                              {labelStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
