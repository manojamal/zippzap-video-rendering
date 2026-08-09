import React, { useState, useEffect } from 'react';
import { BirthdayContact, CelebrativeEvent, InviteContributor } from '../types';
import { createCampaign } from '../services/campaignApi';

interface CreateCampaignProps {
  onAddEvent: (event: CelebrativeEvent) => void;
  onNavigate: (page: string) => void;
  prefilledContact?: BirthdayContact | null;
  onClearPrefilledContact?: () => void;
  /** False for local Demo/Fast-Entry profiles, which have no real Supabase session. */
  isRealAccount?: boolean;
}

export default function CreateCampaign({
  onAddEvent,
  onNavigate,
  prefilledContact,
  onClearPrefilledContact,
  isRealAccount = true,
}: CreateCampaignProps) {
  const [celName, setCelName] = useState('');
  const [occasion, setOccasion] = useState('Birthday');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [emoji, setEmoji] = useState('🎂');
  const [submitting, setSubmitting] = useState(false);
  
  // Initial contributors list state
  const [contributors, setContributors] = useState<InviteContributor[]>([]);
  const [newInvName, setNewInvName] = useState('');
  const [newInvContact, setNewInvContact] = useState('');
  const [newInvMethod, setNewInvMethod] = useState<'WhatsApp' | 'Email' | 'SMS'>('WhatsApp');

  // Trigger auto titles
  useEffect(() => {
    if (prefilledContact) {
      setCelName(prefilledContact.name);
      setDate(prefilledContact.date);
      setOccasion(prefilledContact.rel === 'Colleague' ? 'Promotion' : 'Birthday');
      onClearPrefilledContact?.();
    }
  }, [prefilledContact]);

  useEffect(() => {
    if (celName) {
      setTitle(`${celName}'s Surprise ${occasion}`);
    } else {
      setTitle('');
    }

    // Auto emoji assignment based on occasion
    const emojiMap: Record<string, string> = {
      Birthday: '🎂',
      Anniversary: '💍',
      Wedding: '💒',
      'Baby Shower': '👶',
      Graduation: '🎓',
      Retirement: '👔',
      Promotion: '👑',
      Custom: '✨'
    };
    if (emojiMap[occasion]) {
      setEmoji(emojiMap[occasion]);
    }
  }, [celName, occasion]);

  // Handle addition of temporary invites for this event
  const handleAddInvToEventList = () => {
    if (!newInvName || !newInvContact) {
      alert('⚠️ Name and contact info are both required before adding an invite!');
      return;
    }
    const isDup = contributors.some(c => c.contact === newInvContact);
    if (isDup) {
      alert('⚠️ An invitee with that email or phone contact already exists in this setup!');
      return;
    }
    setContributors(prev => [
      ...prev,
      {
        name: newInvName,
        contact: newInvContact,
        method: newInvMethod,
        sent: true,
        responded: false,
        allowedUpload: true,
        isMuted: false
      }
    ]);
    setNewInvName('');
    setNewInvContact('');
  };

  const handleRemoveInv = (idx: number) => {
    setContributors(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!celName || !title || !date) {
      alert('⚠️ Please supply Celebrant Name, Title, and Milestone Release Date!');
      return;
    }

    setSubmitting(true);
    try {
      // Creates the real row in Supabase and gets back a genuine uuid.
      // A locally-faked id here (the old "e_" + Date.now() pattern) is what
      // caused contributor submissions to silently fail — media_items.campaign_id
      // is a uuid foreign key and rejects anything that isn't a real campaign row.
      const newEvent: CelebrativeEvent = await createCampaign({
        title,
        occasion,
        celebrant: celName,
        date,
        emoji,
        invites: contributors.length > 0 ? contributors : [
          { name: 'Emeka Onyema', contact: 'emeka@demo.ng', method: 'Email', sent: true, responded: false, allowedUpload: true },
          { name: 'Kelechi Egwu', contact: '+2348031234567', method: 'WhatsApp', sent: true, responded: true, allowedUpload: true }
        ],
      });

      onAddEvent(newEvent);
      alert(`🎉 Success! Surprise Campaign for "${celName}" was launched officially.\nInvite link: ${newEvent.link}`);
      onNavigate('dashboard');
    } catch (err: any) {
      const message = err?.message || 'Please check your connection and try again.';
      if (message.includes('must be logged in')) {
        alert(
          '⚠️ You\'re signed in with a local Demo/Fast-Entry profile, which isn\'t a real account.\n\n' +
          'Demo profiles can preview the app, but campaigns need a real account to be saved and synced. ' +
          'Please log out and use "Sign Up" with a real email/password instead.'
        );
      } else {
        alert(`⚠️ Could not create campaign: ${message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      
      {/* Top flow header */}
      <div className="flex items-center gap-3 pb-3 border-b border-orange-100">
        <button
          onClick={() => onNavigate('dashboard')}
          className="p-2 bg-white border border-slate-200 text-slate-700 hover:text-indigo-600 rounded-xl transition text-xs font-bold shrink-0 cursor-pointer"
        >
          🗎 Back
        </button>
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900">✨ Launch Campaign Surprises</h1>
          <p className="text-xs text-slate-500">Initiate a joint team video compilation, audio wishes, and beautiful greeting cards.</p>
        </div>
      </div>

      {!isRealAccount && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-xl shrink-0">⚠️</span>
          <div>
            <p className="text-xs font-black text-amber-800">You're using a local Demo/Fast-Entry profile</p>
            <p className="text-[11px] text-amber-700 mt-1">
              Demo profiles aren't real accounts, so campaigns can't be saved or synced to contributors on other devices.
              Log out and use <strong>Sign Up</strong> with a real email/password to create a campaign that actually works end-to-end.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Event setup column Form */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <span>⚙️</span> Campaign Core Configuration
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Celebrant Name */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Celebrating Person *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Oluwaseun or Dr. Ngozi"
                value={celName}
                onChange={e => setCelName(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 outline-none transition"
              />
            </div>

            {/* Occasion Option Selector */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Surprise Occasion
                </label>
                <select
                  value={occasion}
                  onChange={e => setOccasion(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 outline-none"
                >
                  <option value="Birthday">Birthday 🎂</option>
                  <option value="Anniversary">Anniversary 💍</option>
                  <option value="Wedding">Wedding 💒</option>
                  <option value="Graduation">Graduation 🎓</option>
                  <option value="Baby Shower">Baby Shower 👶</option>
                  <option value="Retirement">Retirement 👔</option>
                  <option value="Promotion">Promotion 👑</option>
                  <option value="Custom">Custom Event ✨</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Symbol Icon
                </label>
                <div className="flex gap-1.5 items-center">
                  <span className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center text-lg">{emoji}</span>
                  <input
                    type="text"
                    maxLength={2}
                    value={emoji}
                    onChange={e => setEmoji(e.target.value)}
                    className="w-14 bg-white border border-slate-200 rounded-xl py-2 text-center text-xs text-slate-900 outline-none"
                    placeholder="🎂"
                  />
                  <span className="text-[10px] text-slate-400 italic">Custom emoji acceptable</span>
                </div>
              </div>
            </div>

            {/* Campaign title generated */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Campaign Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Ngozi's Retirement surprise video compiler"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 focus:border-indigo-600 outline-none transition"
              />
              <p className="text-[9px] text-zinc-400 mt-1">This will be shown on the contributor submission portal screen.</p>
            </div>

            {/* Target Date Milestone Picker */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Surprise Release Date (Milestone deadline) *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 outline-none cursor-pointer"
              />
              <p className="text-[9px] text-zinc-400 mt-1">Countdown triggers auto-reminders and prepares 12:00 Midnight Dispatch automation pipelines.</p>
            </div>

            <button
              type="submit"
              disabled={submitting || !isRealAccount}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-extrabold text-xs tracking-wider uppercase rounded-xl transition cursor-pointer shadow-md shadow-indigo-100 flex items-center justify-center gap-1.5"
            >
              <span>{submitting ? '⏳' : !isRealAccount ? '🔒' : '🚀'}</span> {submitting ? 'Launching…' : !isRealAccount ? 'Sign Up to Launch a Campaign' : 'Start Surprise Campaign'}
            </button>

          </form>
        </div>

        {/* Invite Contributors on configuration panel */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">
              👥 Invite Contributors early
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Secure immediate submissions by queuing up friends and teammate accounts.
            </p>
          </div>

          {/* Quick contributor adding setup */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Contributor Name</label>
              <input
                type="text"
                placeholder="e.g. Emeka Onyema"
                value={newInvName}
                onChange={e => setNewInvName(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none text-xs text-slate-900 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Mobile Number / Email</label>
              <input
                type="text"
                placeholder="e.g. +234803... or emeka@demo`"
                value={newInvContact}
                onChange={e => setNewInvContact(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none text-xs text-slate-900 focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Invite Channel</label>
                <select
                  value={newInvMethod}
                  onChange={e => setNewInvMethod(e.target.value as any)}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white text-xs cursor-pointer"
                >
                  <option value="WhatsApp">📱 WhatsApp</option>
                  <option value="Email">📧 Email Invite</option>
                  <option value="SMS">💬 Direct SMS</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddInvToEventList}
                  className="w-full px-3 py-1.5 bg-indigo-650 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-lg transition text-xs text-center cursor-pointer"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* Listed queued contributors */}
          <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
            <span className="text-[9px] font-black text-slate-400 tracking-wider uppercase block">
              Queued Team Network ({contributors.length})
            </span>
            {contributors.map((contrib, idx) => (
              <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-extrabold text-slate-800 truncate">{contrib.name}</div>
                  <div className="text-[9px] text-slate-400 font-mono truncate">{contrib.contact} · {contrib.method}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveInv(idx)}
                  className="px-1.5 py-1 hover:bg-rose-50 text-rose-500 text-[10px] font-black rounded cursor-pointer"
                  title="Remove from campaign build setup"
                >
                  ✕
                </button>
              </div>
            ))}
            
            {contributors.length === 0 && (
              <p className="text-[10px] text-slate-400 italic text-center py-4 bg-white/40 border border-slate-150 rounded-xl">
                No initial team members invited. Default mockup responders will be pre-seeded upon launch if none added.
              </p>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
