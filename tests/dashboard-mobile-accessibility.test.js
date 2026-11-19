const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

assert.match(html, /id="dashboard-menu-search-input"[^>]*role="combobox"/);
assert.match(html, /aria-controls="dashboard-menu-search-results"/);
assert.match(html, /aria-expanded="false"/);
assert.match(html, /results\.addEventListener\('keydown', handleSearchKeys\)/);
assert.match(html, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
assert.match(html, /event\.key === 'Home' \|\| event\.key === 'End'/);
assert.match(html, /event\.key === 'Escape'/);
assert.match(html, /button\.setAttribute\('aria-selected', 'false'\)/);
assert.match(html, /min-h-\[44px\][^"]*text-right text-xs font-bold/);
assert.match(html, /id="dash-period-from"[^>]*aria-label="تاریخ شروع بازه گزارش داشبورد"/);
assert.match(html, /id="dash-period-to"[^>]*aria-label="تاریخ پایان بازه گزارش داشبورد"/);
assert.match(html, /id="dash-kpis"[^>]*aria-live="polite"/);
assert.match(html, /id="dash-alerts"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /id="dashChart" role="img" aria-label="نمودار روند ماهانه/);
assert.match(html, /<div class="h-64 sm:h-72 w-full">/);

for (const [index, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new (require('node:vm').Script)(match[1], { filename: `index.html:inline-${index}` });
}
console.log('PASS: dashboard search supports keyboard navigation and exposes combobox/listbox state');
console.log('PASS: dashboard controls meet 44px touch target and have accessible labels');
console.log('PASS: KPI, alerts and chart expose accessible descriptions and live updates');
