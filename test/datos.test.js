'use strict';
/* Fase 0: los datos de usuario nunca se versionan y los géneros traen mood/energy/desc. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const genres = require('../data/genres.json');

const root = path.join(__dirname, '..');
const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: root }).status === 0;

test('.gitignore: ningún dato de usuario de data/ se versiona', () => {
  for (const f of ['data/users.json', 'data/sessions.json', 'data/users/1.json', 'data/avatars/1.png', 'data/audio/a.mp3',
    'data/ajustes.json', 'data/horarios.json', 'data/anuncios.json', 'data/podcasts.json', 'data/history.json',
    'data/nominas-permitidas.txt']) {
    assert.ok(ignored(f), `${f} debería estar ignorado`);
  }
});

test('.gitignore: lo versionado de data/ sigue visible', () => {
  assert.ok(!ignored('data/genres.json'));
  assert.ok(!ignored('data/seed/artistas.json'));
});

test('géneros: 479, ids únicos y campos nuevos válidos', () => {
  assert.equal(genres.length, 479);
  assert.equal(new Set(genres.map((g) => g.id)).size, genres.length);
  const MOODS = new Set(['calm', 'focus', 'uplift', 'energy', 'winddown']);
  for (const g of genres) {
    assert.ok(MOODS.has(g.mood), `${g.id}: mood ${g.mood}`);
    assert.ok(Number.isFinite(g.energy) && g.energy >= 0 && g.energy <= 1, `${g.id}: energy ${g.energy}`);
    assert.ok(typeof g.desc === 'string' && g.desc.length > 0, `${g.id}: desc`);
  }
});

test('géneros: se conservan los campos de siempre', () => {
  for (const g of genres) {
    assert.ok(g.id && g.label && g.emoji && g.color && Array.isArray(g.queries) && g.queries.length, g.id);
    assert.equal(typeof g.featured, 'boolean', g.id);
  }
});
