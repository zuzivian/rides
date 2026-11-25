import { parseTripsCsv } from '../core/parse.js';
import { computeStats } from '../core/stats.js';
const text = await (await fetch(new URL('../../data/sample-trips.csv', import.meta.url))).text();
const { trips } = parseTripsCsv(text);
const s = computeStats(trips);
document.getElementById('out').textContent = `${s.count} sample rides parsed.\n\n` + s.lines.join('\n');
