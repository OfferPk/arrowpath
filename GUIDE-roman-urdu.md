# ArrowPath — Istemaal Guide (Roman Urdu)

> Factory rule: har published project mein yeh file `GUIDE-roman-urdu.md` ke naam se zaroori hai.

## 1. Yeh project kya hai?

ArrowPath ek **neon metro arrow puzzle** hai. Grid pe glowing arrows hote hain — unhe tap karo taake wo apni direction mein ur kar board se bahar nikal jayein. Doosre arrow ya wall se takrana = fail. Saari arrows clear = level jeet. Browser mein chalta hai, **offline** bhi (PWA). Login nahi chahiye.

## 2. Kahan se download karein?

- Project path (factory): `/workspace/factory/projects/arrowpath`
- GitHub / ZIP: Master publish karein to yahan link update hoga
- Local build: `npm run build` ke baad `dist/` folder static host pe deploy

## 3. Pehle kya chahiye? (requirements)

- **Node.js** 20+ (dev / build ke liye)
- Modern browser: Chrome / Edge / Firefox / Safari (mobile OK)
- Install (optional): browser → Add to Home Screen

## 4. Install + Run (step-by-step)

1. Terminal kholo aur project folder mein jao:
   ```bash
   cd /workspace/factory/projects/arrowpath
   ```
2. Dependencies:
   ```bash
   npm install
   ```
3. Dev server:
   ```bash
   npm run dev
   ```
4. Browser mein URL kholo (jaise `http://localhost:5173`)
5. Production build:
   ```bash
   npm test && npm run build
   npm run preview
   ```

## 5. Demo login (agar ho)

**Nahi chahiye.** ArrowPath mein koi login / demo account nahi — seedha Play.

| Role | Email | Password |
|------|-------|----------|
| — | — | — |

## 6. Features — har ek kya karta hai

### Play
- **Kahan:** Home → **Play**
- **Kaise:** Arrow pe tap karo; wo apni direction (N/E/S/W) mein chalti hai
- **Result:** Path clear ho to arrow board se nikal jati hai; warna Collision overlay

### Level select
- **Kahan:** Home → **Level select**
- **Kaise:** Unlocked level pe tap (sequence mein unlock)
- **Result:** Us level ka board load hota hai (1–50)

### Undo
- **Kahan:** Play bar → **Undo** (ya fail overlay pe Undo)
- **Kaise:** Har level pe **3 free** undos; khatam hone ke baad rewarded stub ad
- **Result:** Pichla move wapas; fail se bhi recover

### Hint
- **Kahan:** Play HUD → 💡
- **Kaise:** Placeholder rewarded ad confirm karo
- **Result:** Ek safe arrow highlight (yellow glow)

### Retry
- **Kahan:** Play bar / fail overlay → **Retry**
- **Kaise:** Tap
- **Result:** Level reset; interstitial stub call

### Settings — Sound / Remove ads
- **Kahan:** Home → **Settings**
- **Kaise:** Sound toggle; Remove ads (stub) local flag set karta hai
- **Result:** Mute vibration; ads skip jab flag on ho

### How to play
- **Kahan:** Home → **How to play** (pehli dafa auto bhi)
- **Kaise:** Rules parho → Got it
- **Result:** Onboarding flag save

## 7. Common masail (troubleshooting)

- **Board blank / levels load nahi:** `public/levels.json` maujood hai? Dev server project root se chalao.
- **Tap kaam nahi:** Sirf arrow cell pe tap; empty/wall pe kuch nahi hota. Fail overlay band karke retry.
- **PWA offline nahi:** Pehle online `npm run build && npm run preview` se ek baar kholo taake service worker cache kare.
- **`npm test` fail:** Node 20+; `rm -rf node_modules && npm install` phir `npm test`.
- **Progress gayab:** Browser localStorage clear / private mode — progress device-local hai.

## 8. Security / privacy tips

- Koi account / password nahi — personal data server pe nahi bhejte
- Ads/IAP abhi **stubs** hain; real billing keys mat add karo is MVP mein
- Sirf trusted host se `dist/` serve karo

## 9. Agla update

- Real AdMob / remove-ads IAP
- Zyada levels / daily challenge
- Optional sound FX polish
