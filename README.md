# Strength Levels - Setup Guide

## Quick Start (This Weekend!)

### Option A: Just Download and Use
The app works immediately with localStorage. Your parents' data will be saved on their device.

1. Download `index.html`, `manifest.json`, `icon-192.png`, `icon-512.png`
2. Put them in a folder
3. Open `index.html` in a browser
4. Add to home screen (works as PWA)

**Limitation**: Data is device-only. If they clear browser data or use a different device, progress is lost.

---

### Option B: Deploy to Vercel (Recommended)
This gives you a URL that auto-updates when you push changes.

#### 1. Create a GitHub repo
```bash
# In your strength-levels folder
git init
git add .
git commit -m "Initial commit"
# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/strength-levels.git
git push -u origin main
```

#### 2. Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click "New Project"
4. Import your `strength-levels` repo
5. Click "Deploy"

Done! You'll get a URL like `strength-levels.vercel.app`

**Benefits**:
- When you push updates to GitHub, Vercel auto-deploys
- Your parents don't need to reinstall anything
- Works on any device via the URL

---

### Option C: Add Supabase for Cloud Sync
This lets Dad and Mom share data and sync across devices.

#### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project (free tier is fine)
3. Wait for it to initialize (~2 min)

#### 2. Create the Database Table
Go to SQL Editor and run:

```sql
CREATE TABLE user_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_key TEXT UNIQUE NOT NULL,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow public read/write (for simplicity - this is a family app)
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON user_data FOR ALL USING (true);
```

#### 3. Get Your Credentials
1. Go to Settings > API
2. Copy the "Project URL" 
3. Copy the "anon public" key

#### 4. Update the App
In `index.html`, find these lines and replace:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

With your actual values:

```javascript
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGc...your-key...';
```

#### 5. Deploy
Push to GitHub → Vercel auto-deploys → Done!

Now Dad and Mom's workouts sync to the cloud. If they use different devices, data stays in sync.

---

## File Structure

```
strength-levels/
├── index.html      # Main app
├── manifest.json   # PWA manifest
├── icon-192.png    # App icon (192x192)
├── icon-512.png    # App icon (512x512)
└── README.md       # This file
```

## Adding to Home Screen (PWA)

### iPhone/iPad
1. Open the URL in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"
4. Name it "Strength" and tap Add

### Android
1. Open the URL in Chrome
2. Tap the three dots menu
3. Tap "Add to Home screen"
4. Confirm

---

## Updating Videos

To change a video, find the exercise in `index.html` and update the `id` or `search`:

```javascript
videos: [
  { id: 'JlwC2kOHEUU', title: 'Chair Sit-to-Stand', channel: 'HASfit' },
  // To change: go to YouTube, find a video, copy the ID from the URL
  // https://www.youtube.com/watch?v=ABC123xyz → id is 'ABC123xyz'
]
```

For exercises without a specific video, use search:
```javascript
{ search: 'wall pushup seniors form', title: 'Wall Push-Up' }
```

---

## Support

This app uses:
- Vanilla HTML/CSS/JS (no build step needed)
- Supabase for cloud storage (optional)
- PWA for installability

Everything is in one HTML file for simplicity.
