// All persisted application state lives here, as small versioned slices.
import { createSlice } from './storage.js';

export const prefs = createSlice('prefs', {
  scene: 'auto',          // auto | bedroom | garden | cabin | study
  style: 'balanced',      // concise | balanced | detailed
  motion: 'auto',         // auto | reduced
  apiUrl: '',             // optional override of public/config.json
  hour12: null,           // null = device default
});

export const tasks = createSlice('tasks', { items: [] });
export const events = createSlice('events', { items: [] });

export const study = createSlice('study', {
  days: {},               // 'YYYY-MM-DD' -> { focusMin, answered, correct }
  focus: null,            // { endsAt, minutes, label, startedAt } while a session runs
  lastTopic: '',
});

export const layout = createSlice('layout', {
  order: [],              // widget ids in display order ([] = registry default)
  hidden: [],
  sizes: {},
  opts: {},
});

export const chat = createSlice('chat', {
  api: [],                // provider-neutral message history (context)
  view: [],               // rendered transcript
  studyMode: false,
});

export const weather = createSlice('weather', {
  loc: null,              // { name, lat, lon }
  units: 'c',
  cache: null,            // { at, data }
});

export const runtime = { apiUrl: '' }; // resolved at boot from prefs / config.json
