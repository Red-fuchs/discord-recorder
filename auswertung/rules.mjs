// Deterministic rules for meeting evaluation (no LLM): classify() turns LLM labels into decisions/proposals/tasks/..., all checked against the transcript lines.
import { norm } from './lib.mjs';

const sec = t => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
// weak = often a backchannel ("Ja.", "Okay."): never enough alone. strong = explicit assent phrase.
const ASSENT = /^\W*(ja|jo|genau|stimmt|passt|okay|ok|klar|einverstanden|richtig|absolut|sehe ich (auch )?so|gute idee|mach(en)? wir|find ich (auch )?gut|dafür|gerne|top|cool)\b/i;
const STRONG = /(klingt (doch |auch |echt |ja )?(gut|super|vernünftig|nach einem plan)|(dann |das )nehmen wir|(das |es |so )machen wir|einverstanden|abgemacht|stimme (dir |dem )?(da )?zu|sehe ich (auch )?so|(hab|habe) ich (damit |dagegen )?kein(e)? problem|(?<!kein(e)? )gute (idee|sache)|gefällt mir|passt (so|für mich|mir)|lass(en)? uns (das )?(so )?machen|bin (ich )?(auch )?dafür|nicht (da)?gegen)/i;
const VOTE = /(abstimmung|stimmen wir ab|alle dafür|einstimmig|beschlossen)/i;
export const FRIST = /\b(bis (?!dann\b|später\b|gleich\b|bald\b|jetzt\b|hier\b|dahin\b)(zum |nächste[nrm]? |ende |spätestens )?\w+|nächste[nrm]? (woche|monat|runde|treffen)|morgen|übermorgen|heute abend|am (montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|in \w+ (tagen|wochen|monaten)|\d{1,2}\.\d{1,2}\.)/i;
// task = first-person commitment about future work, or an assignment ("mach du X") accepted by the addressee
const WERDE = /\bich\b[^.?!;]{0,30}?\b(werde|wird)\b|\b(werde|wird) ich\b/i;
const DO = /\bich (mache|mach|übernehme|übernehm|kümmere mich|kümmer mich|erledige|besorge)\b|\b(mache|übernehme|erledige|besorge) ich\b/i;
const MODAL = /\b(ich (kann|könnte|würde)|(kann|könnte|würde) ich)\b/i;
const ACT = /\b(machen|erstellen|bauen|schreiben|schauen|nachschauen|suchen|prüfen|testen|erkundigen|recherchieren|übernehmen|kümmern|besorgen|erledigen|setzen|stecken|liefern|schicken|senden|geben|anlegen|aufsetzen|umsetzen|einrichten|probieren|ausprobieren|checken|klären|vorbereiten|validieren|anpassen|ergänzen|hosten|bereitstellen)\b/i;
const NEG = /\b(werde|wird|kann|könnte|würde|mache|mach)( ich)?\b[^.?!]{0,15}\b(nicht|kein\w*|nie)\b|\bich muss (mal )?(kurz|schnell|eben)\b/i;
const ASSIGN = /\b(mach|übernimm|schreib|prüf|schau|bau|besorg)\s+du\b|\bkümmer dich\b|\b(kannst|könntest|würdest|magst) du\b/i;

export function mkRules(ls, who, cfg) {
  const idx = new Map(ls.map((l, i) => [l, i]));
  const spk = n => { const k = norm(n ?? ''); return k && who.find(w => norm(w) === k || (k.length >= 4 && (norm(w).startsWith(k) || k.startsWith(norm(w))))); };
  // line containing the verbatim quote, closest to the claimed time (fixes right-second-wrong-line / right-neighbourhood-wrong-line)
  const lineOf = (t, q) => {
    const x = sec(t), nq = norm(q ?? ''), hit = nq.length >= 6 ? ls.filter(l => Math.abs(l.sec - x) <= 45 && norm(l.text).includes(nq)).sort((a, b) => Math.abs(a.sec - x) - Math.abs(b.sec - x))[0] : null;
    return hit ?? ls.find(l => l.t === t);
  };
  const after = (l, s) => { const out = []; for (let j = idx.get(l) + 1; ls[j] && ls[j].sec <= l.sec + s; j++) out.push(ls[j]); return out; };
  const before = (l, s) => { const out = []; for (let j = idx.get(l) - 1; ls[j] && ls[j].sec >= l.sec - s; j--) out.push(ls[j]); return out; };
  const words = (t, n = 10) => t.split(' ').slice(0, n).join(' ');
  const snip = (t, re) => { const m = t.match(re); if (!m) return words(t); const pre = t.slice(0, m.index).split(' ').length - 1; return t.split(' ').slice(Math.max(0, pre - 3), pre + 8).join(' '); };
  const sents = t => t.split(/(?<=[.?!])\s+/);
  // the sentence (or two) that holds the quote; deadlines/commitments are judged only there, never in the rest of a long line
  const scope = (l, q) => {
    const s = sents(l.text), nq = norm(q ?? '');
    for (const n of [1, 2]) for (let i = 0; i + n <= s.length; i++) { const x = s.slice(i, i + n).join(' '); if (nq && norm(x).includes(nq)) return x; }
    return l.text.length <= 160 ? l.text : q ?? l.text;
  };
  const commit = s => !NEG.test(s) && (WERDE.test(s) || DO.test(s) || (MODAL.test(s) && ACT.test(s))) && !/\?\s*$/.test(s);
  const stems = t => (t.toLowerCase().match(/\p{L}{5,}/gu) ?? []).map(w => w.slice(0, 5));
  const overlaps = (was, l) => { const n = norm(l.text); return stems(was.replace(new RegExp(`^(${who.map(w => w.replace(/\W/g, '\\$&')).join('|')})`, 'i'), '')).some(s => n.includes(s)); };
  function task(l, q, was) {
    let sc = scope(l, q), zitat = q;
    if (!commit(sc)) {   // quote missed the commitment: look at the other sentences of the SAME line, but only one that matches the item's content
      const alt = sents(l.text).find(s => commit(s) && overlaps(was, { text: s }));
      if (alt) { sc = alt; zitat = words(alt); }
      else if (ASSIGN.test(sc)) {
        const a = after(l, 30).find(x => x.who !== l.who && (ASSENT.test(x.text.slice(0, 60)) || sents(x.text).some(commit)));
        return a && { owner: a.who, sc, zitat, was };
      } else return null;
    }
    const s = sents(l.text), n = s[s.findLastIndex(x => sc.includes(x)) + 1];   // a deadline may sit in the directly following sentence only if that is itself a commitment
    if (n && commit(n)) sc += ' ' + n;
    return { owner: l.who, sc, zitat, was: overlaps(was, l) ? was : `${l.who}: ${words(sc, 18)}` };   // model summary about another line → quote the line instead
  }

  function classify(cands, items) {
    const R = { beschluesse: [], vorschlaege: [], aufgaben: [], offene_fragen: [], risiken: [], anwesenheit: [], rollen: [] }, used = new Set();
    const rows = items.map(it => { const k = cands[it.i - 1], l = k && lineOf(k.t, k.zitat); return l && { it, k, l }; }).filter(Boolean).sort((x, y) => idx.get(x.l) - idx.get(y.l));
    const props = new Set(rows.filter(r => r.it.art === 'vorschlag' || r.it.art === 'entscheidung').map(r => r.l));
    for (const { it, k, l } of rows) {
      const base = { t: l.t, zitat: k.zitat }, wer = spk(it.wer), art = it.art, was = (it.was ?? '').trim();
      if (!was && !['geht', 'kommt'].includes(art)) continue;
      if (art === 'entscheidung' || art === 'vorschlag') {
        if (used.has(l)) continue;   // this line is the assent already merged into an earlier proposal
        const nx = []; for (const x of after(l, cfg.assent_window_s)) { if (props.has(x) && !(STRONG.test(x.text) && x.who !== l.who)) break; nx.push(x); }   // assent answers the latest proposal: stop at the next unrelated one
        const vote = nx.some(x => VOTE.test(x.text)), other = nx.filter(x => x.who !== l.who);
        const a = other.find(x => STRONG.test(x.text));
        const prev = STRONG.test(l.text) && before(l, 60).find(x => x.who !== l.who && x.text.split(' ').length >= 5);   // the line itself is the assent
        if (a) { used.add(a); R.beschluesse.push({ ...base, was, zustimmung: [l.who, a.who], t2: a.t, zitat2: snip(a.text, STRONG) }); }
        else if (prev) R.beschluesse.push({ t: prev.t, zitat: words(prev.text), was, zustimmung: [prev.who, l.who], t2: l.t, zitat2: k.zitat });
        else if (art === 'entscheidung' && vote) R.beschluesse.push({ ...base, was, zustimmung: [...new Set([l.who, ...nx.filter(x => ASSENT.test(x.text.slice(0, 60))).map(x => x.who)])] });
        else R.vorschlaege.push({ ...base, was, von: l.who, ...(art === 'entscheidung' ? { herabgestuft: true } : {}) });
      } else if (art === 'aufgabe') {
        const o = task(l, k.zitat, was); if (!o) continue;
        const fr = it.frist && norm(o.sc).includes(norm(it.frist).slice(0, 14)) ? it.frist : o.sc.match(FRIST)?.[0] ?? null;
        R.aufgaben.push({ t: l.t, zitat: o.zitat, was: o.was, owner: o.owner, frist: fr });
      } else if (art === 'risiko') R.risiken.push({ ...base, was });
      else if (art === 'frage') R.offene_fragen.push({ ...base, frage: was, von: l.who });
      else if (art === 'geht' || art === 'kommt') { const p = wer ?? l.who; if (art === 'kommt' || /(tschüss|tschau|ciao|bis dann|muss (los|weg)|bin (raus|weg)|geh(e)? jetzt|mach(e)? schluss|bis später|schönen abend)/i.test(l.text)) R.anwesenheit.push({ ...base, wer: p, art }); }
      else if (art === 'rolle' && wer && it.frist && norm(l.text).includes(norm(it.frist).slice(0, 6))) R.rollen.push({ ...base, wer, rolle: it.frist });
    }
    R.beschluesse = R.beschluesse.filter((e, i, a) => !a.slice(0, i).some(o => Math.abs(sec(o.t) - sec(e.t)) <= cfg.assent_window_s && (o.t === e.t || sim(o.was, e.was) > 0.5)));
    return R;
  }
  return { classify, lineOf, sec };
}

export const sim = (x, y) => { const p = new Set(norm(x).match(/.{1,3}/g) ?? []), q = new Set(norm(y).match(/.{1,3}/g) ?? []); return [...p].filter(z => q.has(z)).length / Math.max(1, Math.min(p.size, q.size)); };
