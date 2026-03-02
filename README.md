# Google Calendar Viewer

A simple Node.js + Express app that signs in with Google OAuth2, fetches upcoming events from your primary Google Calendar, and displays them in a browser.
Latest fetched events are stored in MongoDB (Atlas) per user.

## Prerequisites

- Node.js 18+
- Google Cloud OAuth Client ID + Client Secret
- MongoDB Atlas cluster

## Google Cloud setup

1. In Google Cloud Console, enable the **Google Calendar API**.
2. Configure OAuth consent screen if not already done.
3. In your OAuth Client, add this redirect URI:
   - `http://localhost:3000/oauth2callback`
4. Ensure OAuth consent screen scopes include:
   - `https://www.googleapis.com/auth/calendar.events`

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create env file:

   ```bash
   cp .env.example .env
   ```

3. Fill `.env` with your credentials.
4. Start app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.
6. Click **Connect Google Calendar** and authorize.

## Windows one-click run

Double-click `run-project.bat` in the project root. It will:

- ensure `.env` exists
- ensure MongoDB env variables exist
- install dependencies
- start the server and open `http://localhost:3000`

## Troubleshooting

### 403: insufficient authentication scopes

If the server logs show:

- `Request had insufficient authentication scopes.`

Fix:

1. In Google Cloud Console, go to **APIs & Services -> OAuth consent screen -> Scopes**.
2. Add: `https://www.googleapis.com/auth/calendar.events`
3. Save.
4. In the app, click **Logout** and then **Connect Google Calendar** again.

You can also inspect granted scopes at:

- `GET /api/tokeninfo`

## API endpoints

- `GET /api/me` - auth state and signed-in user profile
- `GET /api/events?maxResults=20` - upcoming events from primary calendar
- `GET /api/events/download` - download the last saved events JSON (after you've loaded events once)
- `POST /auth/logout` - clear local session

## Saved event snapshot

Each time events are loaded, the latest snapshot is upserted in MongoDB collection:

- `event_snapshots` (document keyed by signed-in user's email)
