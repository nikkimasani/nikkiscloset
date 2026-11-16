#!/usr/bin/env node
// Merges two versions of public/starter/made/index.json that both changed since they split (the wardrobe branch made new pieces while
// main took some out on review, or changed the list in an app fix), so a clash never throws a night's pieces away.
//
//   node scripts/merge-index.mjs <base.json> <ours.json> <theirs.json> > index.json      (ours = the wardrobe branch, theirs = main)
//
// Each piece: kept by both, the newer drawing (its t) wins; kept by one side only, it stays if that side made or remade it, and goes if
// the other side took out the drawing they both had. Failed and blocked lists are joined, minus pieces that are in the result.
// Also writes to stderr, one per line, which side's picture each kept piece uses ("ours <id>" / "theirs <id>") and the pieces dropped
// ("drop <id>"), so the workflow can settle clashing .webp files the same way.
import { readFileSync } from 'node:fs';

export function mergeIndex(base, ours, theirs) {
  const bp = base?.pieces || {}, op = ours?.pieces || {}, tp = theirs?.pieces || {};
  const pieces = {}, side = {};
  const same = (a, b) => !!a && !!b && (a.t || 0) === (b.t || 0) && (a.v || 0) === (b.v || 0);
  for (const id of new Set([...Object.keys(op), ...Object.keys(tp)])) {
    const o = op[id], t = tp[id], b = bp[id];
    if (o && t) { const useOurs = (o.t || 0) >= (t.t || 0); pieces[id] = useOurs ? o : t; side[id] = useOurs ? 'ours' : 'theirs'; }
    else if (o) { if (!same(o, b)) { pieces[id] = o; side[id] = 'ours'; } else side[id] = 'drop'; } // (main took out the drawing both had)
    else if (t) { if (!same(t, b)) { pieces[id] = t; side[id] = 'theirs'; } else side[id] = 'drop'; } // (the branch took it out)
  }
  const join = (k) => { const out = { ...(theirs?.[k] || {}), ...(ours?.[k] || {}) }; for (const id of Object.keys(pieces)) delete out[id]; return out; };
  return { result: { version: Math.max(ours?.version || 0, theirs?.version || 0, Date.now()), pieces, failed: join('failed'), blocked: join('blocked') }, side };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
  const [base, ours, theirs] = process.argv.slice(2, 5).map(read);
  const { result, side } = mergeIndex(base, ours, theirs);
  process.stdout.write(JSON.stringify(result, null, 1) + '\n');
  for (const [id, s] of Object.entries(side)) process.stderr.write(`${s} ${id}\n`);
}
