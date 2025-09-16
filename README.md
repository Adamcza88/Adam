# Rotation Watch – Bybit USDT Perp

Jednoduchá webová appka sledující rotaci kapitálu mezi USDT perpetuals na Bybitu.

## Struktura
```
/api/snapshot.ts   # Backend – stahuje data z Bybit API a počítá score
/public/index.html # Frontend – UI dashboard
```

## Nasazení na Vercel
1. Nahraj tento projekt do GitHub repozitáře.
2. Připoj repo na [Vercel](https://vercel.com).
3. Deploy → hotovo.

### Test
- `https://tvojeapp.vercel.app/` → dashboard
- `https://tvojeapp.vercel.app/api/snapshot` → JSON snapshot

