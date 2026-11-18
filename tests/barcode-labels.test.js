const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const [index, source] of scripts.entries()) new vm.Script(source, { filename: 'index.html:inline-script-' + index });

assert.match(html, /id="modal-barcode-settings"/);
assert.match(html, /id="barcode-edit-value"/);
assert.match(html, /id="barcode-label-count"/);
assert.match(html, /id="barcode-label-size"/);
assert.match(html, /function saveBarcodeLabelSettings\(\)/);
assert.match(html, /function renderBarcodeLabelPreview\(p, count, size\)/);
assert.match(html, /format: 'CODE128'/);
assert.match(html, /jsbarcode@3\.11\.6/);

const start = html.indexOf('    function saveBarcodeLabelSettings() {');
const end = html.indexOf('    function renderBarcodeLabelPreview', start);
assert.ok(start >= 0 && end > start, 'barcode settings save function must exist');
const save = html.slice(start, end);
assert.match(save, /count < 1 \|\| count > 200/);
assert.match(save, /state\.products\.some/);
assert.match(save, /addAudit\(/);
assert.match(save, /saveState\(\)/);
assert.doesNotMatch(save, /postVoucher|\.stock\s*=|\.kardex\s*=/, 'barcode editing must not alter inventory or accounting documents');
assert.match(html, /Array\.from\(\{ length: count \}/);
console.log('PASS: barcode editing validates uniqueness, persists through saveState, and prints configurable label batches without stock or voucher changes');

assert.match(html, /onclick="openBarcodeLabelSettings\('\$\{p\.id\}'\)"/);
assert.match(html, /function openBarcodeLabelSettings\(id\)/);
assert.match(html, /modal\.classList\.remove\('hidden'\)/);
assert.match(html, /function printBarcodeLabel\(id\)\s*\{\s*return openBarcodeLabelSettings\(id\);/);
const openStart = html.indexOf('    function openBarcodeLabelSettings(id) {');
const openEnd = html.indexOf('    // Backward-compatible alias', openStart);
assert.ok(openStart >= 0 && openEnd > openStart, 'dedicated barcode settings opener must exist');
assert.doesNotMatch(html.slice(openStart, openEnd), /window\.print|print\(\)/, 'opening barcode settings must not invoke browser printing');

assert.match(html, /id="kardex-from-date"/);
assert.match(html, /id="kardex-to-date"/);
assert.match(html, /function applyKardexDateFilter\(\)/);
assert.match(html, /function clearKardexDateFilter\(\)/);
assert.match(html, /const filteredMovements = movements\.filter/);
assert.match(html, /key >= fromKey && key <= toKey/);
assert.match(html, /تاریخ شروع و پایان شمسی معتبر/);
console.log('PASS: product kardex supports validated Jalali date-range filtering and clearing the filter');

const dateHelpers = html.slice(html.indexOf('    function normalizeJalaliDateInputValue('), html.indexOf('    function isJalaliDateInput('));
assert.ok(dateHelpers.includes('function normalizeJalaliDateInputValue'), 'global Jalali date formatter must exist');
const dateContext = { String, RegExp };
vm.createContext(dateContext);
vm.runInContext(dateHelpers, dateContext);
const normalizeDate = dateContext.normalizeJalaliDateInputValue;
assert.equal(normalizeDate('۰۲۰۱۱۴۰۵'), '1405/01/02');
assert.equal(normalizeDate('1405-01-02', true), '1405/01/02');
assert.equal(normalizeDate('1405/1/2', true), '1405/01/02');
assert.equal(normalizeDate('1405'), '1405');
assert.equal(normalizeDate('140501'), '1405/01');
assert.equal(normalizeDate(''), '');
assert.match(html, /function bindGlobalJalaliDateFormatting\(\)/);
assert.match(html, /document\.addEventListener\('input', event => format\(event\.target, false\), true\)/);
assert.match(html, /document\.addEventListener\('focus', event => format\(event\.target, true\), true\)/);
assert.match(html, /document\.addEventListener\('focusout', event => format\(event\.target, true\), true\)/);
assert.match(html, /document\.querySelectorAll\('input'\)\.forEach\(input => \{ format\(input, true\); addJalaliCalendarButton\(input\); \}\)/);
assert.match(html, /placeholder="۱۴۰۵\/۰۱\/۰۱"/);
assert.match(html, /id === 'ast-dep-period'/);
console.log('PASS: global date inputs normalize Persian/Arabic/English digits and separators to Jalali YYYY/MM/DD while preserving year-month period fields');

assert.match(html, /function openJalaliCalendar\(input\)/, 'date fields must open the Jalali calendar');
assert.match(html, /function chooseJalaliCalendarDay\(day\)/, 'calendar day selection must write the selected date');
assert.match(html, /function changeJalaliCalendarMonth\(delta\)/, 'calendar must support month navigation');
assert.match(html, /function addJalaliCalendarButton\(input\)/, 'date fields must receive a calendar button');
assert.match(html, /انتخاب تاریخ شمسی/);
assert.match(html, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/, 'dynamically rendered date fields must also receive calendar buttons');
assert.match(html, /jalaliCalendarMonthLength/);
assert.match(html, /selectJalaliCalendarToday/);
assert.match(html, /jalali-calendar-trigger/);
console.log('PASS: date fields expose a navigable Jalali calendar picker');

const calendarStart = html.indexOf('    function jalaliCalendarYearDays(');
const calendarEnd = html.indexOf('    function ensureJalaliCalendarOverlay()', calendarStart);
assert.ok(calendarStart >= 0 && calendarEnd > calendarStart, 'calendar date helpers must exist');
const calendarContext = { Math, Number, String, Date, Intl, jalaliDateOrdinal: () => 1, getTodayJalaliDate: () => '1405/01/01' };
vm.createContext(calendarContext);
vm.runInContext(html.slice(calendarStart, calendarEnd), calendarContext);
assert.equal(calendarContext.jalaliCalendarMonthLength(1405, 1), 31);
assert.equal(calendarContext.jalaliCalendarMonthLength(1405, 6), 31);
assert.equal(calendarContext.jalaliCalendarMonthLength(1405, 7), 30);
assert.equal(calendarContext.jalaliCalendarMonthLength(1404, 12), 29);
assert.equal(calendarContext.jalaliCalendarMonthLength(1403, 12), 30);
assert.deepEqual(JSON.parse(JSON.stringify(calendarContext.jalaliCalendarParts('02/01/1405'))), { year: 1405, month: 1, day: 2 });
assert.deepEqual(JSON.parse(JSON.stringify(calendarContext.jalaliCalendarParts('1405/01/02'))), { year: 1405, month: 1, day: 2 });
assert.equal(calendarContext.jalaliCalendarParts('32/01/1405'), null);
console.log('PASS: Jalali calendar month lengths, leap Esfand, and date parsing');

assert.ok(html.includes('#jalali-calendar-overlay.hidden { display:none !important;'), 'closing the calendar must override the overlay display rule');
assert.ok(html.includes("function closeJalaliCalendar() {") && html.includes("overlay.classList.add('hidden')"), 'calendar close action must hide the overlay');
console.log('PASS: Jalali calendar overlay is truly hidden after close');
