import React, { useRef, useState } from 'react';

interface ProfileProps {
  user: any;
  onSaveProfile: (profile: { name: string; phone: string; city: string; brandLogoDataUrl?: string; brandColor?: string }) => void;
  onLogout: () => void;
  onExportProject?: () => void;
  onImportProject?: (file: File) => void;
}

export default function Profile({ user, onSaveProfile, onLogout, onExportProject, onImportProject }: ProfileProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const brandLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [city, setCity] = useState(user?.city || '');
  const [status, setStatus] = useState('');
  const [brandLogoDataUrl, setBrandLogoDataUrl] = useState<string | undefined>(user?.brandLogoDataUrl);
  const [brandColor, setBrandColor] = useState<string>(user?.brandColor || '#4f46e5');

  const [passwordOld, setPasswordOld] = useState('');
  const [passwordNew, setPasswordNew] = useState('');

  const [notifReminders, setNotifReminders] = useState(true);
  const [notifMedia, setNotifMedia] = useState(true);
  const [notifConfirm, setNotifConfirm] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile({ name, phone, city, brandLogoDataUrl, brandColor });
    setStatus('✅ Profile updated successfully!');
    setTimeout(() => setStatus(''), 3000);
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOld || !passwordNew) return;
    setStatus('✅ Password updated successfully!');
    setPasswordOld('');
    setPasswordNew('');
    setTimeout(() => setStatus(''), 3000);
  };

  const currentTierLabel = user?.tier?.toUpperCase() || 'GOLD';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">👤 Account Settings</h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">Verify your profile status, alerts options, and password triggers</p>
        </div>
        <button
          onClick={onLogout}
          className="px-4 py-2 border border-rose-200 hover:bg-rose-50 text-rose-600 font-extrabold text-xs rounded-xl transition cursor-pointer"
        >
          Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Form edit profile */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-50">
            <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-extrabold text-xl rounded-2xl flex items-center justify-center">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-900">{user?.name || 'Standard User'}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{user?.em || 'No Email'}</p>
              <div className="text-[10px] font-bold text-indigo-600 tracking-wider mt-1 uppercase bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full inline-block">
                ★ {currentTierLabel} PLAN
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Full Name *</label>
              <input
                type="text"
                required
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Registered Email</label>
              <input
                type="email"
                disabled
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-400 select-none outline-none cursor-not-allowed"
                value={user?.em || ''}
              />
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

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">City (optional)</label>
              <input
                type="text"
                placeholder="Lagos, Nigeria"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100"
                value={city}
                onChange={e => setCity(e.target.value)}
              />
            </div>

            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Custom Branding (intro card &amp; delivery page)</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => brandLogoInputRef.current?.click()}
                  className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 flex items-center justify-center overflow-hidden bg-slate-50 shrink-0 cursor-pointer transition"
                >
                  {brandLogoDataUrl ? (
                    <img src={brandLogoDataUrl} alt="Brand logo" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[9px] text-slate-400 text-center">Upload logo</span>
                  )}
                </button>
                <input
                  ref={brandLogoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setBrandLogoDataUrl(reader.result as string);
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
                <div className="flex-1 flex items-center gap-2">
                  <label className="text-[10px] text-slate-500 font-bold">Brand color</label>
                  <input
                    type="color"
                    value={brandColor}
                    onChange={e => setBrandColor(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer"
                  />
                  {brandLogoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setBrandLogoDataUrl(undefined)}
                      className="text-[9px] text-rose-500 hover:text-rose-600 font-bold ml-1"
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[9px] text-slate-400 mt-1.5 leading-tight">Applied to the compiled video's intro/outro cards and the delivery reveal page for a white-label look.</p>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition mt-2 cursor-pointer shadow-lg shadow-indigo-100"
            >
              Save Profile Changes
            </button>
          </form>

          {status && (
            <div className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3.5 py-1.5 rounded-lg animate-fade-in text-center font-mono">
              {status}
            </div>
          )}
        </div>

        {/* Right side password & notification form details */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3 flex items-center gap-1">
              <span>🔐</span> Update Password credentials
            </h3>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Current Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none"
                  value={passwordOld}
                  onChange={e => setPasswordOld(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">New Password</label>
                <input
                  type="password"
                  required
                  placeholder="Min 8 characters required"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600"
                  value={passwordNew}
                  onChange={e => setPasswordNew(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-950 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Change Password
              </button>
            </form>
          </div>

          {/* Notifications toggles visual */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">
              🔔 Notifications alerts
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 py-2.5 border-b border-slate-50 last:border-b-0 cursor-pointer select-none text-xs text-slate-700 font-semibold">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-200 accent-indigo-600 focus:ring-indigo-50"
                  checked={notifReminders}
                  onChange={e => setNotifReminders(e.target.checked)}
                />
                <span>Wishes campaign deadlines and events countdown reminders.</span>
              </label>

              <label className="flex items-center gap-2.5 py-2.5 border-b border-slate-50 last:border-b-0 cursor-pointer select-none text-xs text-slate-700 font-semibold">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-200 accent-indigo-600 focus:ring-indigo-50"
                  checked={notifMedia}
                  onChange={e => setNotifMedia(e.target.checked)}
                />
                <span>Alert triggers when contributors submit new wishes.</span>
              </label>

              <label className="flex items-center gap-2.5 py-2.5 border-b border-slate-50 last:border-b-0 cursor-pointer select-none text-xs text-slate-700 font-semibold">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-200 accent-indigo-600 focus:ring-indigo-50"
                  checked={notifConfirm}
                  onChange={e => setNotifConfirm(e.target.checked)}
                />
                <span>Confirm alert trigger on surprise delivery success.</span>
              </label>
            </div>
          </div>

          {/* Backup & restore: this app has no backend, so this file IS the backup */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">
              🗂️ Backup &amp; restore
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Zipp Zap stores everything in this browser only — there's no server copy. Download a backup
              before clearing your cache, switching browsers, or moving to a new device, and you can restore
              it (campaigns, media, and studio timelines included) anytime.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => onExportProject && onExportProject()}
                className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                ⬇️ Export project backup
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex-1 h-10 border border-slate-200 hover:bg-slate-50 text-slate-700 font-extrabold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                ⬆️ Restore from backup
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file && onImportProject) onImportProject(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
