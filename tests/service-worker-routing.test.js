const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sw.js', 'utf8');

function makeResponse(label, type = 'basic') {
  return {
    label,
    ok: true,
    type,
    clone() { return makeResponse(label, type); }
  };
}

function createHarness({ fetchImpl = async () => makeResponse('network') } = {}) {
  const listeners = new Map();
  const stored = new Map();
  const deleted = [];
  const cache = {
    async addAll(paths) { this.precached = [...paths]; },
    async match(key) { return stored.get(typeof key === 'string' ? key : key.url) || null; },
    async put(key, value) { stored.set(typeof key === 'string' ? key : key.url, value); }
  };
  const caches = {
    async open() { return cache; },
    async match(key) { return cache.match(key); },
    async keys() { return ['holoo-pwa-shell-v32', 'holoo-pwa-shell-v33', 'unrelated-cache']; },
    async delete(key) { deleted.push(key); return true; }
  };
  const self = {
    location: { origin: 'https://example.test' },
    clients: { async claim() { self.claimed = true; } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    async skipWaiting() { self.skippedWaiting = true; }
  };
  const context = {
    self, caches, URL, Response: { error: () => ({ label: 'response-error' }) },
    fetch: fetchImpl, Promise, Set
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return {
    self, cache, stored, deleted, listeners,
    async dispatchFetch(request) {
      let responsePromise = null;
      const event = {
        request,
        respondWith(promise) { responsePromise = Promise.resolve(promise); }
      };
      listeners.get('fetch')(event);
      return responsePromise;
    },
    async dispatchLifecycle(name) {
      let pending = Promise.resolve();
      listeners.get(name)({ waitUntil(promise) { pending = Promise.resolve(promise); } });
      await pending;
    }
  };
}

(async () => {
  {
    const h = createHarness();
    const result = await h.dispatchFetch({ method: 'POST', url: 'https://example.test/rest/v1/holoo_sync', mode: 'cors' });
    assert.equal(result, null, 'non-GET writes must not be intercepted by the service worker');
  }
  {
    const h = createHarness();
    const result = await h.dispatchFetch({ method: 'GET', url: 'https://project.supabase.co/rest/v1/holoo_sync', mode: 'cors' });
    assert.equal(result, null, 'Supabase REST traffic must bypass the service worker cache');
  }
  {
    const h = createHarness();
    const result = await h.dispatchFetch({ method: 'GET', url: 'https://untrusted.example/script.js', mode: 'cors' });
    assert.equal(result, null, 'unapproved third-party hosts must not be intercepted');
  }
  {
    const h = createHarness();
    h.stored.set('https://cdn.jsdelivr.net/npm/library.js', makeResponse('cached-cdn'));
    const result = await h.dispatchFetch({ method: 'GET', url: 'https://cdn.jsdelivr.net/npm/library.js', mode: 'cors' });
    assert.equal(result.label, 'cached-cdn', 'allowlisted CDN resources should use their cache when available');
  }
  {
    const h = createHarness({ fetchImpl: async () => { throw new Error('offline'); } });
    h.stored.set('./index.html', makeResponse('offline-shell'));
    const result = await h.dispatchFetch({ method: 'GET', url: 'https://example.test/app/', mode: 'navigate' });
    assert.equal(result.label, 'offline-shell', 'offline navigation must fall back to the cached app shell');
  }
  {
    const h = createHarness({ fetchImpl: async () => { throw new Error('offline'); } });
    h.stored.set('https://example.test/app/module.js', makeResponse('cached-module'));
    const result = await h.dispatchFetch({ method: 'GET', url: 'https://example.test/app/module.js', mode: 'cors' });
    assert.equal(result.label, 'cached-module', 'first-party scripts must have an offline cache fallback');
  }
  {
    const h = createHarness();
    await h.dispatchLifecycle('activate');
    assert.deepEqual(h.deleted, ['holoo-pwa-shell-v32'], 'activation must remove obsolete Holoo shell caches only');
    assert.equal(h.self.claimed, true, 'activation must claim existing clients');
  }
  {
    const h = createHarness();
    await h.dispatchLifecycle('install');
    assert.equal(h.self.skippedWaiting, true, 'successful pre-cache installation should activate the new worker');
    assert.deepEqual(h.cache.precached, [
      './', './index.html', './import-domain.js', './warehouse-audit-domain.js',
      './inventory-cost-audit-domain.js', './invoice-audit-domain.js',
      './warehouse-assignment-domain.js', './operational-tools.js', './manifest.json',
      './icons/icon.svg', './icons/icon-192.svg', './icons/icon-512.svg'
    ]);
  }
  console.log('PASS: service worker API bypass, CDN allowlist, offline shell/script fallback, cache cleanup and install precache');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
