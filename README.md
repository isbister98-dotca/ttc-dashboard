# TTC Live Transit Dashboard

A real-time tracking dashboard for Toronto TTC streetcars and buses, displaying live vehicle locations, speeds, and route information.

## Features

- 🚃 Real-time tracking of TTC streetcars and buses
- 🗺️ Interactive maps with route paths and stops
- 📊 Live statistics including average speeds and active fleet counts
- 🔍 Search functionality for routes
- 📱 Fully responsive design for mobile and desktop
- ⚡ Auto-updating every 5 seconds

## Local Development

1. Simply open `index.html` in your web browser
2. No build process required - it's a static site!

## Deploy to Vercel

### Prerequisites
- A GitHub account
- A Vercel account (you can sign up for free at https://vercel.com)

### Step-by-Step Deployment Instructions

#### 1. Create a GitHub Repository

1. Go to https://github.com and sign in
2. Click the "+" button in the top right corner
3. Select "New repository"
4. Name your repository (e.g., `ttc-dashboard`)
5. Choose "Public" or "Private"
6. Do NOT initialize with README (we already have files)
7. Click "Create repository"

#### 2. Upload Your Files to GitHub

**Option A: Using GitHub Web Interface (Easiest for beginners)**

1. On your new repository page, click "uploading an existing file"
2. Drag and drop all these files:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `vercel.json`
   - `README.md`
3. Scroll down and click "Commit changes"

**Option B: Using Git Command Line (if you're comfortable with terminal)**

```bash
# Navigate to your project folder
cd /path/to/ttc-dashboard

# Initialize git
git init

# Add all files
git add .

# Commit files
git commit -m "Initial commit"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git

# Push to GitHub
git branch -M main
git push -u origin main
```

#### 3. Deploy to Vercel

1. Go to https://vercel.com and sign in (or create an account)
2. Click "Add New..." button → "Project"
3. Click "Import" next to your GitHub repository
   - If you don't see it, click "Adjust GitHub App Permissions" and grant access
4. Configure your project:
   - **Framework Preset:** Leave as "Other" (it will auto-detect)
   - **Root Directory:** Leave as "./"
   - **Build Command:** Leave empty
   - **Output Directory:** Leave empty
5. Click "Deploy"
6. Wait 30-60 seconds for deployment to complete
7. Your site will be live at a URL like: `your-project-name.vercel.app`

#### 4. Custom Domain (Optional)

1. In your Vercel project dashboard, go to "Settings" → "Domains"
2. Add your custom domain
3. Follow Vercel's instructions to update your domain's DNS settings

## How It Works

- Fetches live data from TTC's XML feed API
- Uses CORS proxies to handle cross-origin requests
- Updates vehicle positions and statistics every 5 seconds
- Interactive Leaflet maps show routes, stops, and live vehicles
- Clicking stops shows live departure predictions

## Browser Support

Works on all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers

## Troubleshooting

**Dashboard shows "Connecting..." forever:**
- Check your internet connection
- The TTC API might be temporarily down
- CORS proxies might be experiencing issues

**Maps not loading:**
- Ensure you have a stable internet connection
- Check browser console for errors (F12)

**Data seems outdated:**
- The dashboard auto-refreshes every 5 seconds
- Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)

## Credits

Built using:
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Leaflet](https://leafletjs.com/) for interactive maps
- [TTC's NextBus XML Feed](http://retro.umoiq.com/xmlFeedDocs/NextBusXMLFeed.pdf) for real-time data

## License

Free to use and modify for personal and commercial projects.
