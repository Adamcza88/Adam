// /api/snapshot.ts — Rotation Watch (403-safe, Vercel)
import type { VercelRequest, VercelResponse } from 'vercel';

// 👉 spusť v Asii (Bybit tam 403 nedává tak často)
export const config = { regions: ['sin1','hnd1'] as const };

const DOMAINS = ['https://api.bybit.com', 'https://api.bytick.com']; // mirror fallback
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 RotationWatch',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

const SYMBOL_LIMIT = Number(process.env.SYMBOL_LIMIT ?? 100);
const OI_INTERVAL = '5min';
const KLINE_INTERVAL_MIN = 5;
const LOOKBACK_SEC = 60 * 60;

async function fetchJson(path: string, timeoutMs = 10000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  let lastErr: any = null;

  for (const host of DOMAINS) {
    try {
      const r = await fetch(host + path, { headers: HEADERS, signal: ctl.signal, cache: 'no-store' });
      if (r.status === 403) { lastErr = new Error('HTTP 403'); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); clearTimeout(to); return j;
    } catch (e) { lastErr = e; }
  }
  clearTimeout(to);
  throw lastErr ?? new Error('Fetch failed');
}

type Row = { symbol: string, dPrice15: number, dVol15: number, dOI15: number, funding: number, score: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1) Symboly
    const inst = await fetchJson(`/v5/market/instruments-info?category=linear`);
    const symbols: string[] = inst?.result?.list
      ?.filter((x: any) => x.quoteCoin === 'USDT' && x.status === 'Trading')
      ?.map((x: any) => x.symbol).slice(0, SYMBOL_LIMIT) ?? [];
    if (!symbols.length) throw new Error('No symbols resolved');

    // 2) Tickers (funding)
    const tickers = await fetchJson(`/v5/market/tickers?category=linear`);
    const tmap: Record<string, any> = Object.fromEntries((tickers?.result?.list ?? []).map((t: any) => [t.symbol, t]));

    // 3) OI + klíny
    const now = Math.floor(Date.now()/1000);
    const startMs = (now - LOOKBACK_SEC) * 1000, endMs = now * 1000;

    const rows: Row[] = [];
    for (const s of symbols.slice(0, 60)) {
      const oi = await fetchJson(`/v5/market/open-interest?category=linear&symbol=${s}&interval=${OI_INTERVAL}`);
      const oiSeries = (oi?.result?.list ?? []).map((x:any)=>({t:+x.timestamp, oi:+x.openInterest})).sort((a,b)=>a.t-b.t);

      const kl = await fetchJson(`/v5/market/kline?category=linear&symbol=${s}&interval=${KLINE_INTERVAL_MIN}&start=${startMs}&end=${endMs}`);
      const k = (kl?.result?.list ?? []).map((r:any)=>({t:+r[0], c:+r[4], v:+r[5]})).reverse();

      const last = k.at(-1), prev = k.at(-4) ?? k[0];
      const dPrice15 = (last && prev) ? ((last.c - prev.c)/Math.max(prev.c,1e-9))*100 : 0;

      const volMA = (()=>{const w=k.slice(-60); const s=w.reduce((a,b)=>a+b.v,0); return w.length? s/w.length : 1;})();
      const vol15 = k.slice(-3).reduce((a,b)=>a+b.v,0)/Math.max(1,Math.min(3,k.length));
      const dVol15 = ((vol15/Math.max(volMA,1e-9))-1)*100;

      const dOI15 = (()=>{ if (oiSeries.length<4) return 0;
        const a=oiSeries.at(-1)!.oi, b=oiSeries.at(-4)!.oi; return ((a-b)/Math.max(b,1e-9))*100; })();

      const funding = parseFloat(tmap[s]?.fundingRate ?? '0') * 100;

      rows.push({ symbol:s, dPrice15, dVol15, dOI15, funding, score:0 });
    }

    // 4) Scoring
    const z = (arr:number[]) => { const m=arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length);
      const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/Math.max(1,arr.length))||1; return (x:number)=>(x-m)/sd; };
    const zv = z(rows.map(r=>r.dVol15)), zoi = z(rows.map(r=>r.dOI15));

    const scored = rows.map(r=>{
      const score = 0.45*zv(r.dVol15) + 0.45*zoi(r.dOI15) + 0.10*(r.dPrice15/1) - 0.10*Math.abs(r.funding);
      return { ...r, score };
    }).sort((a,b)=>b.score-a.score);

    res.setHeader('Cache-Control','s-maxage=15, stale-while-revalidate=30');
    res.status(200).json({ ts: Date.now(), rows: scored });
  } catch (err:any) {
    res.status(500).json({ error:true, message:String(err?.message ?? err) });
  }
}