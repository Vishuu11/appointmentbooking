const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  SESSION_SECRET,
  MONGODB_URI,
  MONGODB_DB_NAME,
  PORT = 3000,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

if (!SESSION_SECRET) {
  console.error('Missing SESSION_SECRET in .env');
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

if (!GOOGLE_REDIRECT_URI) {
  console.error('Missing GOOGLE_REDIRECT_URI in .env');
  process.exit(1);
}

const app = express();
const mongoClient = new MongoClient(MONGODB_URI);
let eventSnapshotsCollection;
let calendarEventsCollection;
let userProfilesCollection;
let usersCollection;
let resolvedMongoDbName;

function safeFileId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function resolveMongoDbName() {
  const envDb = String(MONGODB_DB_NAME || '').trim();
  if (envDb) return envDb;
  try {
    const parsed = new URL(MONGODB_URI);
    const fromPath = parsed.pathname.replace(/^\//, '').trim();
    return fromPath || 'test';
  } catch {
    return 'test';
  }
}

function buildOAuthClient(redirectUri) {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

function getRedirectUriForRequest(req) {
  const configured = String(GOOGLE_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const host = req.get('host') || `localhost:${PORT}`;
  return `http://${host}/oauth2callback`;
}

function getOAuthClientForRequest(req) {
  const redirectUri = req.session?.oauthRedirectUri || getRedirectUriForRequest(req);
  const client = buildOAuthClient(redirectUri);
  if (req.session?.tokens) {
    client.setCredentials(req.session.tokens);
  }
  return client;
}

function getSessionEmail(req) {
  const email = req.session?.user?.email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

function requireLocalAuth(req, res, next) {
  if (!req.session?.localUser) {
    return res.status(401).json({ message: 'Local login required.' });
  }
  return next();
}

function hashPassword(password, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), actualSalt, 100000, 64, 'sha512').toString('hex');
  return { salt: actualSalt, hash };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const attempt = crypto.pbkdf2Sync(String(password), stored.salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(stored.hash));
}

async function ensureAdminUser() {
  const existing = await usersCollection.findOne({ username: 'admin' });
  if (existing) return;
  const { salt, hash } = hashPassword('admin');
  await usersCollection.insertOne({
    username: 'admin',
    password: { salt, hash },
    createdAt: new Date(),
    lastLoginAt: null,
  });
  console.log('Seeded default admin user (admin/admin).');
}

async function initMongo() {
  await mongoClient.connect();
  resolvedMongoDbName = resolveMongoDbName();
  const db = mongoClient.db(resolvedMongoDbName);
  eventSnapshotsCollection = db.collection('event_snapshots');
  calendarEventsCollection = db.collection('calendar_events');
  userProfilesCollection = db.collection('user_profiles');
  usersCollection = db.collection('users');
  await eventSnapshotsCollection.createIndex({ email: 1 }, { unique: true });
  await calendarEventsCollection.createIndex({ email: 1, eventId: 1 }, { unique: true });
  await calendarEventsCollection.createIndex({ email: 1, googleUpdatedAt: -1 });
  await userProfilesCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  await ensureAdminUser();
  console.log(
    `MongoDB connected. DB=${resolvedMongoDbName}, collections=event_snapshots,calendar_events,user_profiles,users`
  );
}

async function saveEventsSnapshot(email, payload, queryMeta) {
  const result = await eventSnapshotsCollection.updateOne(
    { email },
    {
      $set: {
        email,
        payload,
        queryMeta,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return result;
}

async function getEventsSnapshot(email) {
  const doc = await eventSnapshotsCollection.findOne({ email });
  return doc?.payload || null;
}

async function upsertUserProfile(user, grantedScopes) {
  if (!user?.email) return;
  await userProfilesCollection.updateOne(
    { email: user.email },
    {
      $set: {
        email: user.email,
        name: user.name || null,
        picture: user.picture || null,
        grantedScopes: Array.isArray(grantedScopes) ? grantedScopes : [],
        lastLoginAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function getEventStartValue(event) {
  return event?.start?.dateTime || event?.start?.date || null;
}

function getEventEndValue(event) {
  return event?.end?.dateTime || event?.end?.date || null;
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}


async function upsertFullEvents(email, calendarId, events, queryMeta) {
  const safeEvents = Array.isArray(events) ? events : [];
  const ops = safeEvents
    .filter((event) => event && typeof event === 'object' && typeof event.id === 'string')
    .map((event) => ({
      updateOne: {
        filter: { email, eventId: event.id },
        update: {
          $set: {
            email,
            eventId: event.id,
            calendarId,
            status: event.status || null,
            summary: event.summary || null,
            description: event.description || null,
            location: event.location || null,
            htmlLink: event.htmlLink || null,
            creatorEmail: event.creator?.email || null,
            organizerEmail: event.organizer?.email || null,
            start: getEventStartValue(event),
            end: getEventEndValue(event),
            googleUpdatedAt: toDateOrNull(event.updated),
            queryMeta,
            rawEvent: event,
            lastSyncedAt: new Date(),
            deletedAt: null,
          },
        },
        upsert: true,
      },
    }));

  if (!ops.length) {
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }

  const result = await calendarEventsCollection.bulkWrite(ops, { ordered: false });
  return {
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  };
}

async function markEventDeleted(email, eventId) {
  if (!eventId) return;
  await calendarEventsCollection.updateOne(
    { email, eventId },
    {
      $set: {
        email,
        eventId,
        status: 'cancelled',
        deletedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function requireAuth(req, res) {
  if (!req.session.tokens) {
    res.status(401).json({ message: 'Not authenticated.' });
    return false;
  }
  return true;
}

function getSendUpdates(value) {
  const v = String(value || '').trim();
  if (!v) return undefined;
  if (v === 'all' || v === 'none' || v === 'externalOnly') return v;
  return undefined;
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

app.use(express.json({ limit: '256kb' }));

app.use(express.static(path.join(__dirname, 'public')));


const SCOPES = [
  // Read/write access to events (includes reading events).
  // Note: switching from readonly requires re-consent (logout then connect again).
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

async function getGrantedScopes(tokens) {
  // Helpful for debugging "insufficient authentication scopes" errors.
  if (!tokens?.access_token) return null;
  try {
    const tokenClient = new google.auth.OAuth2();
    const info = await tokenClient.getTokenInfo(tokens.access_token);
    return info?.scopes || null;
  } catch {
    return null;
  }
}

app.post('/api/local/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const user = await usersCollection.findOne({ username: String(username).trim() });
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    req.session.localUser = { username: user.username };
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } }
    );

    return res.json({ ok: true, user: { username: user.username } });
  } catch (error) {
    console.error('Local login failed:', error?.message || error);
    return res.status(500).json({ message: 'Local login failed.' });
  }
});

app.post('/api/local/logout', (req, res) => {
  req.session.localUser = undefined;
  req.session.tokens = undefined;
  req.session.user = undefined;
  req.session.grantedScopes = undefined;
  req.session.lastEventsQuery = undefined;
  res.status(204).end();
});

app.get('/api/local/me', (req, res) => {
  if (!req.session?.localUser) return res.json({ authenticated: false });
  return res.json({ authenticated: true, user: req.session.localUser });
});

app.get('/auth/google', requireLocalAuth, (req, res) => {
  const redirectUri = getRedirectUriForRequest(req);
  req.session.oauthRedirectUri = redirectUri;
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const oauthClientForAuth = buildOAuthClient(redirectUri);

  const authUrl = oauthClientForAuth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    redirect_uri: redirectUri,
  });

  res.redirect(authUrl);
});

app.get('/oauth2callback', requireLocalAuth, async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description: errorDescription } = req.query;

    if (oauthError) {
      console.error(
        'OAuth provider returned error:',
        oauthError,
        errorDescription || '',
        'redirectUri=',
        req.session.oauthRedirectUri || getRedirectUriForRequest(req)
      );
      return res
        .status(400)
        .send(`OAuth error: ${oauthError}${errorDescription ? ` - ${errorDescription}` : ''}`);
    }

    if (!code) {
      return res.status(400).send('Missing OAuth code.');
    }

    if (!state || state !== req.session.oauthState) {
      return res.status(400).send('Invalid OAuth state.');
    }

    const redirectUri = req.session.oauthRedirectUri || getRedirectUriForRequest(req);
    const oauthClientForCallback = buildOAuthClient(redirectUri);

    const { tokens } = await oauthClientForCallback.getToken({
      code,
      redirect_uri: redirectUri,
    });
    req.session.tokens = tokens;
    req.session.oauthState = undefined;
    req.session.oauthRedirectUri = undefined;

    // Cache basic profile info in session (used for per-user snapshot storage).
    try {
      const oauthClientForProfile = buildOAuthClient(redirectUri);
      oauthClientForProfile.setCredentials(tokens);
      const oauth2 = google.oauth2({ auth: oauthClientForProfile, version: 'v2' });
      const profile = await oauth2.userinfo.get();
      req.session.user = {
        name: profile.data.name || null,
        email: profile.data.email || null,
        picture: profile.data.picture || null,
      };
    } catch (e) {
      // Profile fetch isn't strictly required for calendar reads.
      req.session.user = undefined;
      console.warn('Warning: failed to fetch user profile during OAuth callback:', e?.message || e);
    }

    const scopes = await getGrantedScopes(tokens);
    if (scopes) {
      req.session.grantedScopes = scopes;
      if (!scopes.includes('https://www.googleapis.com/auth/calendar.events')) {
        console.warn(
          'Warning: OAuth token missing calendar.events scope. Granted scopes:',
          scopes
        );
      }
    } else {
      req.session.grantedScopes = undefined;
    }

    await upsertUserProfile(req.session.user, req.session.grantedScopes);

    // Auto-sync once right after login so Mongo is populated without requiring manual refresh.
    try {
      await refreshAndPersistLatest(req);
    } catch (syncError) {
      console.warn('Post-login event sync failed:', syncError?.message || syncError);
    }

    res.redirect('/');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed. Check server logs.');
  }
});

app.post('/auth/logout', requireLocalAuth, (req, res) => {
  req.session.tokens = undefined;
  req.session.user = undefined;
  req.session.grantedScopes = undefined;
  req.session.lastEventsQuery = undefined;
  res.status(204).end();
});

app.get('/api/me', requireLocalAuth, async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.json({ authenticated: false });
    }

    // Prefer cached session profile; fall back to live request if missing.
    let user = req.session.user;
    if (!user) {
      const oauthClient = getOAuthClientForRequest(req);
      const oauth2 = google.oauth2({ auth: oauthClient, version: 'v2' });
      const profile = await oauth2.userinfo.get();
      user = {
        name: profile.data.name || null,
        email: profile.data.email || null,
        picture: profile.data.picture || null,
      };
      req.session.user = user;
    }

    await upsertUserProfile(user, req.session.grantedScopes);

    return res.json({
      authenticated: true,
      user: {
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
      grantedScopes: req.session.grantedScopes || null,
    });
  } catch (error) {
    console.error('Failed to load profile:', error);
    return res.status(500).json({ message: 'Failed to load profile.' });
  }
});

app.get('/api/tokeninfo', requireLocalAuth, async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }

  const scopes = await getGrantedScopes(req.session.tokens);
  return res.json({ scopes });
});

app.get('/api/events', requireLocalAuth, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const maxResults = Math.min(Number(req.query.maxResults) || 20, 100);
    const timeMin = req.query.timeMin || new Date().toISOString();
    req.session.lastEventsQuery = { maxResults, timeMin };

    const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const rawEvents = response.data.items || [];
    const events = rawEvents.map((event) => ({
      id: event.id,
      status: event.status,
      summary: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      htmlLink: event.htmlLink,
      creator: event.creator?.email || '',
      organizer: event.organizer?.email || '',
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      updated: event.updated || null,
    }));

    const email = getSessionEmail(req);

    const payload = {
      fetchedAt: new Date().toISOString(),
      calendarId: 'primary',
      timeMin,
      maxResults,
      count: events.length,
      events,
    };

    let fullEventsResult = null;
    let saveResult = null;
    if (email) {
      fullEventsResult = await upsertFullEvents(email, 'primary', rawEvents, {
        maxResults,
        timeMin,
      });
      saveResult = await saveEventsSnapshot(email, payload, { maxResults, timeMin });
    }
    res.json({
      ...payload,
      storage: {
        ok: Boolean(email),
        db: resolvedMongoDbName,
        collections: ['event_snapshots', 'calendar_events', 'user_profiles'],
        email,
        upsertedId: saveResult?.upsertedId || null,
        matchedCount: saveResult?.matchedCount || 0,
        modifiedCount: saveResult?.modifiedCount || 0,
        eventDocuments: fullEventsResult || { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 },
        reason: email ? null : 'No user email available for storage.',
      },
    });
  } catch (error) {
    const data = error.response?.data;
    console.error('Failed to fetch events:', data || error.message || error);

    const status = Number(data?.error?.code) || 500;
    if (
      status === 403 &&
      (data?.error?.message || '').toLowerCase().includes('insufficient authentication scopes')
    ) {
      return res.status(403).json({
        message:
          'Google token missing Calendar scope. Ensure you consented to calendar.events, then logout and re-connect.',
        details: data?.error || null,
        grantedScopes: req.session.grantedScopes || null,
      });
    }

    return res.status(500).json({ message: 'Failed to fetch Google Calendar events.' });
  }
});

async function refreshAndPersistLatest(req) {
  // Re-list events after a write so the JSON download stays in sync.
  const maxResults = Math.min(Number(req.session.lastEventsQuery?.maxResults) || 20, 100);
  const timeMin = req.session.lastEventsQuery?.timeMin || new Date().toISOString();

  const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const rawEvents = response.data.items || [];
  const events = rawEvents.map((event) => ({
    id: event.id,
    status: event.status,
    summary: event.summary || '(No title)',
    description: event.description || '',
    location: event.location || '',
    htmlLink: event.htmlLink,
    creator: event.creator?.email || '',
    organizer: event.organizer?.email || '',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    updated: event.updated || null,
  }));

  const payload = {
    fetchedAt: new Date().toISOString(),
    calendarId: 'primary',
    timeMin,
    maxResults,
    count: events.length,
    events,
  };

  const email = getSessionEmail(req);
  if (email) {
    const fullEventsResult = await upsertFullEvents(email, 'primary', rawEvents, {
      maxResults,
      timeMin,
    });
    const saveResult = await saveEventsSnapshot(email, payload, { maxResults, timeMin });
    console.log(
      `Snapshot saved for ${email}. matched=${saveResult.matchedCount}, modified=${saveResult.modifiedCount}, upserted=${saveResult.upsertedId ? 'yes' : 'no'}`
    );
    console.log(
      `Full events synced for ${email}. matched=${fullEventsResult.matchedCount}, modified=${fullEventsResult.modifiedCount}, upserted=${fullEventsResult.upsertedCount}`
    );
  } else {
    console.warn('Skipping MongoDB sync: no user email available.');
  }
  return payload;
}

app.get('/api/events/:eventId', requireLocalAuth, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: req.params.eventId,
    });
    return res.json(event.data);
  } catch (error) {
    const data = error.response?.data;
    console.error('Failed to get event:', data || error.message || error);
    return res.status(500).json({ message: 'Failed to load event.' });
  }
});

app.patch('/api/events/:eventId', requireLocalAuth, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { summary, description, location, start, end } = req.body || {};
    const sendUpdates = getSendUpdates(req.query.sendUpdates);

    const requestBody = {};
    if (typeof summary === 'string') requestBody.summary = summary;
    if (typeof description === 'string') requestBody.description = description;
    if (typeof location === 'string') requestBody.location = location;

    function applyStartEnd(fieldName, value) {
      if (typeof value === 'string') {
        // Back-compat: treat as RFC3339 datetime.
        if (Number.isNaN(new Date(value).getTime())) {
          throw new Error(`Invalid ${fieldName} datetime.`);
        }
        requestBody[fieldName] = { dateTime: value };
        return;
      }

      if (value && typeof value === 'object') {
        // All-day
        if (typeof value.date === 'string') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
            throw new Error(`Invalid ${fieldName} date (expected YYYY-MM-DD).`);
          }
          requestBody[fieldName] = { date: value.date };
          return;
        }

        // Timed
        if (typeof value.dateTime === 'string') {
          if (Number.isNaN(new Date(value.dateTime).getTime())) {
            throw new Error(`Invalid ${fieldName} datetime.`);
          }
          const payload = { dateTime: value.dateTime };
          if (typeof value.timeZone === 'string' && value.timeZone.trim()) {
            payload.timeZone = value.timeZone.trim();
          }
          requestBody[fieldName] = payload;
          return;
        }
      }
    }

    try {
      applyStartEnd('start', start);
      applyStartEnd('end', end);
    } catch (e) {
      return res.status(400).json({ message: e?.message || 'Invalid start/end.' });
    }

    if (!Object.keys(requestBody).length) {
      return res.status(400).json({ message: 'No editable fields provided.' });
    }

    const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: req.params.eventId,
      sendUpdates,
      requestBody,
    });

    const latest = await refreshAndPersistLatest(req);
    return res.json({ ok: true, latest });
  } catch (error) {
    const data = error.response?.data;
    console.error('Failed to update event:', data || error.message || error);

    const status = Number(data?.error?.code) || 500;
    if (
      status === 403 &&
      (data?.error?.message || '').toLowerCase().includes('insufficient authentication scopes')
    ) {
      return res.status(403).json({
        message:
          'Missing Google Calendar write scope. Logout and re-connect, then approve calendar.events.',
        details: data?.error || null,
        grantedScopes: req.session.grantedScopes || null,
      });
    }

    return res.status(500).json({
      message: data?.error?.message || 'Failed to update event.',
      details: data?.error || null,
    });
  }
});

app.delete('/api/events/:eventId', requireLocalAuth, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const email = getSessionEmail(req);
    const sendUpdates = getSendUpdates(req.query.sendUpdates);
    const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: req.params.eventId,
      sendUpdates,
    });
    if (email) {
      await markEventDeleted(email, req.params.eventId);
    }

    const latest = await refreshAndPersistLatest(req);
    return res.json({ ok: true, latest });
  } catch (error) {
    const data = error.response?.data;
    console.error('Failed to delete event:', data || error.message || error);

    const status = Number(data?.error?.code) || 500;
    if (
      status === 403 &&
      (data?.error?.message || '').toLowerCase().includes('insufficient authentication scopes')
    ) {
      return res.status(403).json({
        message:
          'Missing Google Calendar write scope. Logout and re-connect, then approve calendar.events.',
        details: data?.error || null,
        grantedScopes: req.session.grantedScopes || null,
      });
    }

    return res.status(500).json({
      message: data?.error?.message || 'Failed to delete event.',
      details: data?.error || null,
    });
  }
});

app.post('/api/events/:eventId/cancel', requireLocalAuth, async (req, res) => {
  // Google Calendar API doesn't have a separate "cancel" call for most events;
  // "cancelling" is effectively deleting the event (optionally notifying attendees).
  try {
    if (!requireAuth(req, res)) return;

    const email = getSessionEmail(req);
    const sendUpdates = getSendUpdates(req.query.sendUpdates) || 'all';
    const calendar = google.calendar({ version: 'v3', auth: getOAuthClientForRequest(req) });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: req.params.eventId,
      sendUpdates,
    });
    if (email) {
      await markEventDeleted(email, req.params.eventId);
    }

    const latest = await refreshAndPersistLatest(req);
    return res.json({ ok: true, latest });
  } catch (error) {
    const data = error.response?.data;
    console.error('Failed to cancel event:', data || error.message || error);

    const status = Number(data?.error?.code) || 500;
    if (
      status === 403 &&
      (data?.error?.message || '').toLowerCase().includes('insufficient authentication scopes')
    ) {
      return res.status(403).json({
        message:
          'Missing Google Calendar write scope. Logout and re-connect, then approve calendar.events.',
        details: data?.error || null,
        grantedScopes: req.session.grantedScopes || null,
      });
    }

    return res.status(500).json({ message: 'Failed to cancel event.' });
  }
});

app.get('/api/events/download', requireLocalAuth, async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).send('Not authenticated.');
    }

    const email = getSessionEmail(req);
    if (!email) {
      return res.status(400).send('No user email available yet. Refresh after login.');
    }
    const payload = await getEventsSnapshot(email);
    if (!payload) {
      return res.status(400).send('No saved events yet. Click Refresh first.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `calendar-events-${safeFileId(email)}-${stamp}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(payload, null, 2) + '\\n');

  } catch (e) {
    console.error('Failed to download events:', e?.message || e);
    return res.status(500).send('Failed to download JSON.');
  }
});

async function handleStorageSync(req, res) {
  try {
    if (!requireAuth(req, res)) return;
    const latest = await refreshAndPersistLatest(req);
    const email = getSessionEmail(req);
    if (!email) {
      return res.json({
        ok: false,
        db: resolvedMongoDbName,
        email: null,
        message: 'No user email available for storage sync.',
      });
    }
    const eventDocCount = await calendarEventsCollection.countDocuments({ email });
    const userDoc = await userProfilesCollection.findOne(
      { email },
      { projection: { _id: 0, email: 1, name: 1, lastLoginAt: 1 } }
    );
    return res.json({
      ok: true,
      db: resolvedMongoDbName,
      email,
      count: latest.count,
      eventDocumentCount: eventDocCount,
      userProfile: userDoc || null,
    });
  } catch (error) {
    console.error('Manual storage sync failed:', error?.message || error);
    return res.status(500).json({ message: 'Manual storage sync failed.' });
  }
}

app.post('/api/storage-sync', requireLocalAuth, handleStorageSync);
app.get('/api/storage-sync', requireLocalAuth, handleStorageSync);

app.get('/api/storage-status', requireLocalAuth, async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }
    const email = getSessionEmail(req);
    if (!email) {
      return res.json({
        ok: false,
        db: resolvedMongoDbName,
        email: null,
        message: 'No user email available yet.',
      });
    }
    const doc = await eventSnapshotsCollection.findOne(
      { email },
      { projection: { _id: 0, email: 1, updatedAt: 1, queryMeta: 1 } }
    );
    const userDoc = await userProfilesCollection.findOne(
      { email },
      { projection: { _id: 0, email: 1, name: 1, picture: 1, grantedScopes: 1, lastLoginAt: 1 } }
    );
    const eventDocCount = await calendarEventsCollection.countDocuments({ email });
    const activeEventDocCount = await calendarEventsCollection.countDocuments({
      email,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    const recentEvents = await calendarEventsCollection
      .find({ email }, { projection: { _id: 0, eventId: 1, summary: 1, status: 1, lastSyncedAt: 1 } })
      .sort({ lastSyncedAt: -1 })
      .limit(5)
      .toArray();
    return res.json({
      ok: true,
      db: resolvedMongoDbName,
      collections: ['event_snapshots', 'calendar_events', 'user_profiles'],
      email,
      exists: Boolean(doc),
      document: doc || null,
      userProfileExists: Boolean(userDoc),
      userProfile: userDoc || null,
      eventDocumentCount: eventDocCount,
      activeEventDocumentCount: activeEventDocCount,
      recentEvents,
    });
  } catch (error) {
    console.error('Failed to read storage status:', error?.message || error);
    return res.status(500).json({ message: 'Failed to read storage status.' });
  }
});

app.get(/^\/(?!api|auth|oauth2callback).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ message: 'Invalid JSON payload.' });
  }
  console.error('Unhandled error:', err?.message || err);
  return res.status(500).json({ message: 'Server error.' });
});

async function startServer() {
  try {
    await initMongo();
    app.listen(PORT, () => {
      console.log(`Google Calendar Viewer running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error?.message || error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await mongoClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await mongoClient.close();
  process.exit(0);
});

startServer();

