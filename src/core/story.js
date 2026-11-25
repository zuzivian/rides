// Story helpers: a rule-based rider "personality" and real-world distance
// comparisons. Pure functions of computeStats() output.
import { KM_PER_MILE } from './geo.js';

/** @typedef {import('./stats.js').Stats} Stats */

/**
 * Familiar distances, in miles. `one` and `many` are the phrases used for
 * one and several multiples.
 */
const DISTANCES = [
  { mi: 13.4, one: 'the length of Manhattan', many: 'lengths of Manhattan' },
  { mi: 382, one: 'a drive from San Francisco to Los Angeles', many: 'drives from San Francisco to Los Angeles' },
  { mi: 2800, one: 'a drive across the US', many: 'drives across the US' },
  { mi: 24901, one: 'a trip around the Earth', many: 'trips around the Earth' },
];

/**
 * The biggest familiar distance you've covered at least once.
 * @param {number} km
 * @returns {{times:number, phrase:string, text:string}|null}
 */
export function distanceComparison(km) {
  const mi = km / KM_PER_MILE;
  let pick = null;
  for (const d of DISTANCES) if (mi >= d.mi) pick = d;
  if (!pick) return null;
  const times = mi / pick.mi;
  const rounded = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
  const text = rounded === 1 ? `That’s ${pick.one}.` : `That’s ${rounded} ${pick.many}.`;
  return { times, phrase: rounded === 1 ? pick.one : pick.many, text };
}

/** Share of the way around the Earth (0..∞). @param {number} km */
export const earthShare = (km) => km / 40075;

/**
 * @typedef {Object} Trait
 * @property {string} key
 * @property {string} noun
 * @property {string} adj
 * @property {number} score  value / threshold; ≥1 means the trait applies
 * @property {string} reason plain sentence explaining it
 */

/**
 * Rule-based personality. Every trait has a threshold. The strongest trait
 * gives the noun, and the runner-up (if it also applies) gives the adjective.
 * @param {Stats} s
 */
export function personality(s) {
  const n = s.count || 1;
  const place = (id) => s.places.find((p) => p.id === id);
  const commute = s.routes.filter((r) => {
    const a = place(r.from)?.kind; const b = place(r.to)?.kind;
    return (a === 'home' && b === 'work') || (a === 'work' && b === 'home');
  }).reduce((t, r) => t + r.count, 0) / n;
  const weekend = (s.byWeekday[5] + s.byWeekday[6]) / n;
  const morning = s.byHour.slice(5, 10).reduce((a, b) => a + b, 0) / n;
  const top3 = s.routes.slice(0, 3).reduce((t, r) => t + r.count, 0) / n;
  const cities = s.cities.filter((c) => c.name !== 'Unknown').length;
  const pct = (x) => `${Math.round(x * 100)}%`;

  /** @type {Trait[]} */
  const traits = [
    { key: 'commute', noun: 'Commuter', adj: 'Commuting', score: commute / 0.2, reason: `${pct(commute)} of your rides are between home and work.` },
    { key: 'night', noun: 'Night Owl', adj: 'Night Owl', score: s.lateNight.share / 0.08, reason: `${pct(s.lateNight.share)} of your rides start between midnight and 5 am.` },
    { key: 'jet', noun: 'Jet-Setter', adj: 'Jet-Setting', score: Math.max((s.airports.count / Math.max(1, s.spanDays / 365)) / 12, cities / 4), reason: `${s.airports.count} airport runs across ${cities} ${cities === 1 ? 'city' : 'cities'}.` },
    { key: 'weekend', noun: 'Weekend Wanderer', adj: 'Weekend', score: weekend / 0.4, reason: `${pct(weekend)} of your rides are on Saturdays and Sundays.` },
    { key: 'habit', noun: 'Creature of Habit', adj: 'Loyal', score: top3 / 0.5, reason: `Your top three routes make up ${pct(top3)} of your rides.` },
    { key: 'explore', noun: 'Explorer', adj: 'Curious', score: (s.places.length / n) / 0.25, reason: `You’ve been dropped off at ${s.places.length} different places.` },
    { key: 'early', noun: 'Early Bird', adj: 'Early-Bird', score: morning / 0.3, reason: `${pct(morning)} of your rides start between 5 and 10 am.` },
  ].sort((a, b) => b.score - a.score);

  const on = traits.filter((t) => t.score >= 1);
  if (!on.length) return { title: 'The Occasional Rider', traits: on, reasons: ['You ride when you need to, with no single habit standing out.'] };
  const [primary, secondary] = on;
  const title = secondary && secondary.adj !== primary.noun ? `The ${secondary.adj} ${primary.noun}` : `The ${primary.noun}`;
  return { title, traits: on, reasons: on.slice(0, 3).map((t) => t.reason) };
}
