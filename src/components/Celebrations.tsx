import React, { useState } from 'react';
import { BirthdayContact, CelebrativeEvent } from '../types';
import { daysTo, fmtD } from '../utils';

interface CelebrationsProps {
  birthdays: BirthdayContact[];
  onAddContact: (contact: Omit<BirthdayContact, 'id'>) => void;
  onPlanSurprise: (contactId: string) => void;
  onDeleteContact: (id: string) => void;
}

export default function Celebrations({
  birthdays,
  onAddContact,
  onPlanSurprise,
  onDeleteContact
}: CelebrationsProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [rel, setRel] = useState('Friend');
  const [date, setDate] = useState('');
  const [phone, setPhone] = useState('');

  const cols = ['#FF6B1A', '#0F9E5E', '#1A6FDB', '#6B21D9', '#B8780A'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !date) return;
    onAddContact({
      name,
      rel,
      date,
      phone,
      emoji: '🎂'
    });
    setName('');
    setDate('');
    setPhone('');
    setShowAddModal(false);
  };

  const upcomingBirthdays = birthdays
    .filter(b => daysTo(b.date) >= 0)
    .sort((a, b) => daysTo(a.date) - daysTo(b.date));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900">🎂 Celebration Calendar</h1>
          <p className="text-xs text-slate-500">Track and plan upcoming surprise campaigns for friends, family, and teammates</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-md shadow-indigo-100 cursor-pointer"
        >
          ＋ Add Contact
        </button>
      </div>

      {/* Occasion slider buttons pill */}
      <div className="flex gap-2 overflow-x-auto pb-2 select-none scrollbar-thin">
        {['🎂 Birthdays', '💍 Anniversaries', '💒 Weddings', '👶 Baby Showers', '🎓 Graduations', '👔 Retirements'].map((o, idx) => (
          <div
            key={o}
            className={`px-4 py-2 rounded-full border text-xs font-semibold cursor-pointer transition flex-shrink-0 ${
              idx === 0
                ? 'bg-indigo-50 border-indigo-200 text-indigo-600 font-bold'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {o}
          </div>
        ))}
      </div>

      {/* Birthday Contacts List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {upcomingBirthdays.length > 0 ? (
          upcomingBirthdays.map(b => {
            const daysLeft = daysTo(b.date);
            const col = cols[b.name.charCodeAt(0) % cols.length];

            return (
              <div key={b.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-bold"
                      style={{ backgroundColor: `${col}12`, color: col }}
                    >
                      {b.emoji || b.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 leading-tight">{b.name}</h3>
                      <p className="text-xs text-slate-400 capitalize">{b.rel} · {fmtD(b.date)}</p>
                      {b.phone && <p className="text-[10px] text-slate-400 mt-1 font-mono">{b.phone}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-2xl font-black ${
                        daysLeft <= 7 ? 'text-rose-600' : daysLeft <= 14 ? 'text-amber-500' : 'text-emerald-600'
                      }`}
                    >
                      {daysLeft}
                    </div>
                    <div className="text-[9px] font-bold text-slate-400 tracking-wider">DAYS LEFT</div>
                  </div>
                </div>

                {/* Progress bar element visual */}
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full"
                    style={{ width: `${Math.max(4, 100 - Math.min((daysLeft / 30) * 100, 100))}%` }}
                  ></div>
                </div>

                {/* Interaction controls */}
                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => onPlanSurprise(b.id)}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-xs rounded-lg transition"
                  >
                    🚀 Plan Surprise
                  </button>
                  <button className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-xs rounded-lg transition">
                    📱 Contact
                  </button>
                  <div className="flex-1"></div>
                  <button
                    onClick={() => onDeleteContact(b.id)}
                    className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 hover:text-rose-600 text-slate-400 rounded-lg transition text-xs font-bold"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-2 text-center py-20 bg-slate-50 border border-slate-150 rounded-2xl">
            <span className="text-4xl block filter grayscale mb-3">🎂</span>
            <p className="text-sm font-bold text-slate-800">Your celebration directory is empty</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">Add your friends or family to plan special gifts or surprise compile videos!</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl"
            >
              Add Contact
            </button>
          </div>
        )}
      </div>

      {/* Add Contact Modal overlay */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 my-auto">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-bold flex items-center justify-center hover:bg-slate-200"
            >
              ×
            </button>
            <h2 className="text-lg font-black text-slate-900 mb-1">🎂 Add Birthday Contact</h2>
            <p className="text-xs text-slate-500 mb-4">Receive automated alerts and plan surprising videos seamlessly</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oluwaseun Adeyemi"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Relationship</label>
                  <select
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                    value={rel}
                    onChange={e => setRel(e.target.value)}
                  >
                    <option>Friend</option>
                    <option>Family</option>
                    <option>Colleague</option>
                    <option>Partner</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Birthday *</label>
                  <input
                    type="date"
                    required
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Phone (optional)</label>
                <input
                  type="text"
                  placeholder="+234..."
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition mt-2 cursor-pointer shadow-lg shadow-indigo-100"
              >
                Save Contact Entry
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
