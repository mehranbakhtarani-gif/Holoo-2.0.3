const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

for (const [index, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + index });
}

const dashboardStart = html.indexOf('<section id="mod-dashboard"');
const dashboardEnd = html.indexOf('<!-- ==================== MODULE 2:', dashboardStart);
assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart, 'dashboard markup must be present');
const dashboard = html.slice(dashboardStart, dashboardEnd);

assert.match(dashboard, /ثبت فروش/);
assert.match(dashboard, /<details class="relative">[\s\S]*?ابزارهای بیشتر[\s\S]*?تست سلامت سیستم/);
assert.doesNotMatch(dashboard, /داشبورد مدیریتی یکپارچه و وضعیت ابری/);
assert.match(dashboard, /id="dash-kpis" class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4/);
assert.match(dashboard, /grid grid-cols-1 lg:grid-cols-3/);
assert.match(dashboard, /order-1 lg:order-2[\s\S]*?id="dash-alerts"/);
assert.match(dashboard, /order-2 lg:order-1 lg:col-span-2[\s\S]*?id="dashChart"/);
assert.match(dashboard, /id="dash-alert-count"/);
assert.match(dashboard, /۱۴ میان‌بر از ۱۹ ماژول/);
assert.match(dashboard, /id="dash-trend-insights"/);
assert.match(dashboard, /id="dash-alert-severity"/);
assert.match(dashboard, /id="dash-alert-toggle"[^>]*onclick="toggleDashboardAlerts\(\)"/);
assert.match(dashboard, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4/);

const quickLinks = dashboard.slice(dashboard.indexOf('aria-label="دسترسی سریع به بخش‌ها"'));
const destinations = [...quickLinks.matchAll(/navigateTo\('([^']+)'\)/g)].map(match => match[1]);
assert.deepEqual(destinations.slice(0, 6), ['invoices','products','inventory','treasury','accounting','imports']);
assert.equal(destinations.length, 14, 'dashboard quick access count must match its visible label');
assert.match(quickLinks, /ثبت فاکتور فروش/);
assert.match(quickLinks, /min-h-\[52px\]/);
console.log('PASS: dashboard actions are simplified behind a compact tools disclosure');
console.log('PASS: KPI cards, alerts and chart have deliberate responsive mobile/desktop ordering');
console.log('PASS: quick-access actions are prioritized and retain touch-friendly targets');
