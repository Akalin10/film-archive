# 暗房 · Film Archive

A distinctive, production-grade static photo archive web application with a film darkroom aesthetic.

## Design Direction

**Film Archive / Editorial Darkroom** — warm cream backgrounds, charcoal text, subtle paper grain, film-frame borders on every photo. The masonry puzzle layout adapts to every aspect ratio without cropping — like browsing a photographer's contact sheet archive.

- **Typography**: Fraunces (display) + Work Sans (body) — editorial warmth with clean readability
- **Palette**: Warm cream (#FBF8F4), deep charcoal (#1E1D1C), amber accents (#B8752C)
- **Texture**: SVG noise grain overlay at 3.5% opacity
- **Layout**: CSS Grid masonry with per-image `grid-row-end: span N` calculated from actual aspect ratios

## Features

### Photo Gallery
- Masonry puzzle waterfall layout — adapts to horizontal, vertical, square, and ultra-wide photos
- Keeps original aspect ratios, no forced cropping
- Responsive: mobile (320px+), tablet, desktop

### Sorting & Filtering
- Sort by date taken, upload date, or title — ascending/descending
- Filter by: All / Featured / Recent (7 days)
- Tag-based filtering with chip UI
- Active filters bar shows current state

### Upload
- Single, batch, and drag-and-drop upload
- Preview before saving with metadata form
- Fields: title, description, date, location, tags, album assignment
- Automatic thumbnail generation (canvas-based, 400px max side, JPEG 75%)
- Admin password protection for upload access

### Lightbox Viewer
- Full-screen image preview with backdrop blur
- Previous/next navigation
- Keyboard arrows and touch swipe support
- Shows: title, date, location, description, tags
- Click tags to filter gallery
- Edit, delete, toggle featured/private from lightbox

### Album Management
- Create albums with name, description, privacy setting
- Assign photos to albums during upload or edit
- Private albums with password protection
- Browse photos by album
- Custom album covers

### Search
- Full-text search across title, description, location, tags
- Filter by search type (all fields / title / tags / location)
- Date range filtering

### Privacy
- Public vs private photos
- Admin password for upload access
- Password-protected private albums
- Session-based authentication

## Architecture

### Tech Stack
- **Zero dependencies** — pure HTML, CSS, vanilla JavaScript
- **IndexedDB** for persistent photo storage (images stored as blobs)
- **CSS Grid** masonry layout with computed row spans
- **Canvas API** for client-side thumbnail generation

### File Structure
```
frontend-design/
├── index.html      # Application shell (311 lines)
├── style.css        # Complete design system + responsive (1589 lines)
├── app.js           # All application logic (1600+ lines)
└── README.md
```

### Data Model (IndexedDB)
```
Database: FilmArchive v1
├── photos store { id, title, description, dateTaken, dateUploaded,
│                   location, tags[], albumId, isFeatured, isPublic,
│                   imageData (Blob), thumbnailData (Blob), width, height }
├── albums store { id, name, description, coverPhotoId, isPrivate,
│                  password, dateCreated }
└── settings store { key, value }
```

## Getting Started

### Standalone (file:// or any static server)
```bash
# Option 1: Open directly in browser
open index.html

# Option 2: Serve with any static server
npx serve .
python -m http.server 8080
```

### Default Admin Password
On first launch, the admin password is set to: **`darkroom`**

Change it via browser DevTools:
```javascript
// In console
const DB = await new Promise(r => {
  const req = indexedDB.open('FilmArchive');
  req.onsuccess = e => r(e.target.result);
});
const tx = DB.transaction('settings', 'readwrite');
tx.objectStore('settings').put({ key: 'adminPassword', value: 'your-new-password' });
```

## Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `←` `→` | Navigate lightbox |
| `Esc` | Close lightbox / modals / clear tag filter |
| `Ctrl+K` or `/` | Open search |

## Browser Support
- Chrome/Edge 90+
- Firefox 90+
- Safari 15+
- Mobile Safari (iOS 15+)
- Chrome for Android

## Storage Limitations
IndexedDB storage limits vary by browser (~50MB–2GB+). For production use with many high-resolution photos, consider upgrading to Supabase Storage, Cloudflare R2, or Firebase Storage. The data layer (`dbTransaction`, `dbPut`, etc.) is isolated for easy migration.

## Deployment
Deploy anywhere that serves static files:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- Any static file server

No build step required.
