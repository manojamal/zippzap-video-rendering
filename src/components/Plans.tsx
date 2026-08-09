import React from 'react';
import { PlanTier } from '../types';
import { TIERS } from '../utils';

interface PlansProps {
  user: any;
  onUpgradePlan: (tierId: string) => void;
}

export default function Plans({ user, onUpgradePlan }: PlansProps) {
  const currentTier = user?.tier || 'freemium';

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">⚡ Simple, transparent pricing details</h1>
        <p className="text-sm text-slate-500">Pick the plan that fits your group celebration needs. Upgrade or cancel anytime.</p>
      </div>

      {/* Grid of pricing cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-4">
        {Object.values(TIERS)
          .filter(t => t.id !== 'demo') // Hide demo tier from general checkout options
          .map(tier => {
            const isCurrent = currentTier === tier.id;
            return (
              <div
                key={tier.id}
                className={`bg-white border rounded-2xl p-6 shadow-sm flex flex-col justify-between relative ${
                  isCurrent ? 'border-2 border-indigo-600 ring-4 ring-indigo-50/50' : 'border-slate-200'
                }`}
              >
                {/* Popular badges tags */}
                {tier.id === 'gold' && (
                  <div className="absolute top-[-10px] left-1/2 transform -translate-x-1/2 bg-amber-500 text-white font-bold text-[9px] uppercase tracking-widest px-3 py-1 rounded-full shadow-sm">
                    Most Popular
                  </div>
                )}
                {tier.id === 'elite' && (
                  <div className="absolute top-[-10px] left-1/2 transform -translate-x-1/2 bg-purple-600 text-white font-bold text-[9px] uppercase tracking-widest px-3 py-1 rounded-full shadow-sm">
                    Best Value
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-2xl block">{tier.i}</span>
                      <h3 className="text-base font-extrabold text-slate-950 mt-1">{tier.l}</h3>
                    </div>
                    {isCurrent && (
                      <span className="px-2.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-full text-[9px] font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="text-3xl font-black text-slate-900">{tier.p}</div>
                    <div className="text-[10px] text-slate-400">Fixed rate pricing monthly</div>
                  </div>

                  <ul className="text-xs text-slate-600 space-y-2 border-t border-slate-100 pt-4">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>
                        {tier.msgAllowance === Infinity ? 'Unlimited' : tier.msgAllowance} messages / mo
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>
                        {tier.videoUploads === Infinity ? 'Unlimited' : tier.videoUploads} video files / mo
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>Studio mode: <strong className="capitalize">{tier.studio}</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>{tier.support} included</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-2.5 bg-slate-100 text-slate-500 text-xs font-bold rounded-xl outline-none select-none cursor-not-allowed"
                    >
                      Current Active Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => onUpgradePlan(tier.id)}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow transition cursor-pointer"
                    >
                      Subscribe {tier.l} ➔
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Feature comparisons table matrix */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-extrabold text-slate-900">Comprehensive Plan Matrix comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs select-none">
            <thead>
              <tr className="border-b-2 border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">SURPRISE FEAT</th>
                <th className="py-3 px-4">🆓 FREE</th>
                <th className="py-3 px-4 text-emerald-600">⭐ STANDARD</th>
                <th className="py-3 px-4 text-amber-600">🥇 GOLD</th>
                <th className="py-3 px-4 text-purple-600">💎 ELITE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-3 px-4 font-bold">Monthly Messages Limit</td>
                <td className="py-3 px-4">2 wishes</td>
                <td className="py-3 px-4 text-emerald-600 font-semibold">20 messages</td>
                <td className="py-3 px-4 text-amber-600 font-semibold">75 messages</td>
                <td className="py-3 px-4 text-purple-600 font-bold">Widescale Unlimited</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold">Video Upload Files</td>
                <td className="py-3 px-4">1 video</td>
                <td className="py-3 px-4 text-emerald-600 font-semibold">5 video clips</td>
                <td className="py-3 px-4 text-amber-600 font-semibold">20 clips</td>
                <td className="py-3 px-4 text-purple-600 font-bold">Widescale Unlimited</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold">Live AI Compile</td>
                <td className="py-3 px-4">✕</td>
                <td className="py-3 px-4 text-slate-400">✕</td>
                <td className="py-3 px-4 text-emerald-600 font-bold">✓ (Auto Compile)</td>
                <td className="py-3 px-4 text-emerald-600 font-bold">✓ (Auto Compile)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold">Volume Mixer Suite</td>
                <td className="py-3 px-4">✕</td>
                <td className="py-3 px-4 text-slate-400">✕</td>
                <td className="py-3 px-4 text-emerald-600 font-bold">✓ Full Mixer</td>
                <td className="py-3 px-4 text-emerald-600 font-bold">✓ Premium Mixer</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold">Welcome Bonus Reward</td>
                <td className="py-3 px-4">20 pts</td>
                <td className="py-3 px-4">50 pts bonus</td>
                <td className="py-3 px-4">100 pts bonus</td>
                <td className="py-3 px-4">300 pts bonus</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
