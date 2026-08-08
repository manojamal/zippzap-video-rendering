import React, { useState } from 'react';
import { SurpriseTheme } from '../types';
import { SURPRISE_THEMES, applyThemeStyle } from '../utils';

interface ThemeSelectorProps {
  onThemeChange?: (themeId: string) => void;
}

export default function ThemeSelector({ onThemeChange }: ThemeSelectorProps) {
  const [customOrange, setCustomOrange] = useState('#FF6B1A');
  const [customBg, setCustomBg] = useState('#FFF8F0');
  const [customCard, setCustomCard] = useState('#FFF0E4');
  const [customInk, setCustomInk] = useState('#1C1207');

  const handleApplyPreset = (theme: SurpriseTheme) => {
    applyThemeStyle(theme.colors);
    if (onThemeChange) onThemeChange(theme.id);
  };

  const handleApplyCustom = () => {
    applyThemeStyle({
      orange: customOrange,
      c1: customBg,
      c2: customCard,
      ink: customInk
    });
    if (onThemeChange) onThemeChange('custom');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">🎨 Theme & Accent Selector</h1>
        <p className="text-xs text-slate-500 mt-1">Personalise the visual identity of your surprise dashboard and contributor flows</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SURPRISE_THEMES.map(theme => (
          <div
            key={theme.id}
            onClick={() => handleApplyPreset(theme)}
            className="bg-white border border-slate-200 rounded-2xl p-5 hover:indigo-500 shadow-sm transition-all duration-150 cursor-pointer overflow-hidden group hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold text-white shrink-0 group-hover:scale-105 transition"
                style={{ backgroundColor: theme.colors.orange }}
              >
                {theme.emoji}
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm text-slate-900 leading-tight">{theme.name}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">{theme.desc}</p>
              </div>
            </div>

            <div className="flex gap-1 mb-4 select-none">
              <div className="flex-1 h-5 rounded-lg" style={{ backgroundColor: theme.colors.orange }}></div>
              <div className="flex-1 h-5 rounded-lg border border-slate-100" style={{ backgroundColor: theme.colors.c1 }}></div>
              <div className="flex-1 h-5 rounded-lg" style={{ backgroundColor: theme.colors.ink }}></div>
              <div className="flex-1 h-5 rounded-lg border border-slate-100" style={{ backgroundColor: theme.colors.c2 }}></div>
            </div>

            <button
              onClick={e => {
                e.stopPropagation();
                handleApplyPreset(theme);
              }}
              className="w-full py-2 bg-indigo-50 group-hover:bg-indigo-650 hover:text-white group-hover:text-indigo-600 transition text-[10px] font-black uppercase text-indigo-600 rounded-lg cursor-pointer flex items-center justify-center gap-1.5"
            >
              Apply Theme Preset
            </button>
          </div>
        ))}
      </div>

      {/* Custom palette selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
          <span>🎨</span> Bespoke Color Palette Builder
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
          <div className="text-center space-y-1.5">
            <input
              type="color"
              className="w-full h-11 border border-slate-200 rounded-xl cursor-pointer p-0.5"
              value={customOrange}
              onChange={e => setCustomOrange(e.target.value)}
            />
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Primary Accent</div>
          </div>
          <div className="text-center space-y-1.5">
            <input
              type="color"
              className="w-full h-11 border border-slate-200 rounded-xl cursor-pointer p-0.5"
              value={customBg}
              onChange={e => setCustomBg(e.target.value)}
            />
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Main Background</div>
          </div>
          <div className="text-center space-y-1.5">
            <input
              type="color"
              className="w-full h-11 border border-slate-200 rounded-xl cursor-pointer p-0.5"
              value={customCard}
              onChange={e => setCustomCard(e.target.value)}
            />
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Card Element</div>
          </div>
          <div className="text-center space-y-1.5">
            <input
              type="color"
              className="w-full h-11 border border-slate-200 rounded-xl cursor-pointer p-0.5"
              value={customInk}
              onChange={e => setCustomInk(e.target.value)}
            />
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Base Typography</div>
          </div>
        </div>

        <button
          onClick={handleApplyCustom}
          className="w-full max-w-xs block bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer shadow-lg shadow-indigo-100"
        >
          Activate Custom Palette
        </button>
      </div>
    </div>
  );
}
