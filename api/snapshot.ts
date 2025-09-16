// /api/snapshot.ts — Rotation Watch (Bybit USDT Perp)
import type { VercelRequest, VercelResponse } from 'vercel';

const BYBIT = 'https://api.bybit.com';
const SYMBOL_LIMIT = Number(process.env.SYMBOL_LIMIT ?? 120);
const OI_INTERVAL = '5min';
const KLINE_INTERVAL_MIN = 5;
const LOOKBACK_SEC = 60 * 60;
const UA = { 'User-Agent': 'RotationWatch/1.0 (+vercel)' };

async function fetchJson(url: string, timeoutMs = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

type Row = {
  symbol: string, dPrice15: number, dVol15: number, dOI15: number, funding: number, score: number
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const inst = await fetchJson(`${BYBIT}/v5/market/instruments-info?category=linear`);
    const symbols: string[] = inst?.result?.list
      ?.filter((x: any) => x.quoteCoin === 'USDT' && x.status === 'Trading')
      ?.map((x: any) => x.symbol)
      ?.slice(0, SYMBOL_LIMIT) ?? [];

    if (symbols.length === 0) {
      throw new Error('No symbols resolved from instruments-info');
    }

    const tickers = await fetchJson(`${BYBIT}/v5/market/tickers?category=linear`);
    const tmap: Record<string, any> = Object.fromEntries(
      (tickers?.result?.list ?? []).map((t: any) => [t.symbol, t])
    );

    const now = Math.floor(Date.now() / 1000);
    const startMs = (now - LOOKBACK_SEC) * 1000;
    const endMs = now * 1000;

    const rows: Row[] = [];
    for (const s of symbols.slice(0, 20)) {
      const oi = await fetchJson(
        `${BYBIT}/v5/market/open-interest?category=linear&symbol=${s}&interval=${OI_INTERVAL}`
      );
      const oiSeries = (oi?.result?.list ?? [])
        .map((x: any) => ({ t: +x.timestamp, oi: +x.openInterest }))
        .sort((a: any, b: any) => a.t - b.t);

      const kl = await fetchJson(
        `${BYBIT}/v5/market/kline?category=linear&symbol=${s}&interval=${KLINE_INTERVAL_MIN}&start=${startMs}&end=${endMs}`
      );
      const k = (kl?.result?.list ?? [])
        .map((r: any) => ({ t: +r[0], c: +r[4], v: +r[5] }))
        .reverse();

      const last = k.at(-1);
      const prev = k.at(-4) ?? k[0];
      const dPrice15 = last && prev ? ((last.c - prev.c) / Math.max(prev.c, 1e-9)) * 100 : 0;

      const volMA = (() => {
        const win = k.slice(-60);
        const sum = win.reduce((a, b) => a + b.v, 0);
        return win.length ? sum / win.length : 1;
      })();
      const vol15 = k.slice(-3).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(3, k.length));
      const dVol15 = ((vol15 / Math.max(volMA, 1e-9)) - 1) * 100;

      const dOI15 = (() => {
        if (oiSeries.length < 4) return 0;
        const a = oiSeries.at(-1)!.oi;
        const b = oiSeries.at(-4)!.oi;
        return ((a - b) / Math.max(b, 1e-9)) * 100;
      })();

      const funding = parseFloat(tmap[s]?.fundingRate ?? '0') * 100;
      rows.push({ symbol: s, dPrice15, dVol15, dOI15, funding, score: 0 });
    }

    const zs = (arr: number[]) => {
      const m = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, arr.length)) || 1;
      return { m, sd, z: (x: number) => (x - m) / sd };
    };
    const zv = zs(rows.map(r => r.dVol15));
    const zoi = zs(rows.map(r => r.dOI15));

    const scored = rows.map(r => {
      const score =
        0.45 * zv.z(r.dVol15) +
        0.45 * zoi.z(r.dOI15) +
        0.10 * (r.dPrice15 / 1) -
        0.10 * Math.abs(r.funding);
      return { ...r, score };
    }).sort((a, b) => b.score - a.score);

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json({ ts: Date.now(), rows: scored });

  } catch (err: any) {
    res.status(500).json({ error: true, message: err?.message ?? 'Unknown error' });
  }
}
