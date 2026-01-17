
import { isoToDateString, parseDate, getTodayISO } from './spa/utils/DateUtils.js';

// Mock debugError
global.debugError = (...args) => console.error(...args);

function test() {
    console.log('Starting DateUtils tests...');

    // Test isoToDateString
    const cases = [
        { input: '2026-01-17T00:00:00.000Z', expected: '2026-01-17', desc: 'UTC ISO string' },
        { input: '2026-01-17', expected: '2026-01-17', desc: 'Date string only' },
        { input: new Date(2026, 0, 17), expected: '2026-01-17', desc: 'Date object (local)' },
    ];

    cases.forEach(c => {
        const result = isoToDateString(c.input);
        if (result === c.expected) {
            console.log(`✅ [isoToDateString] ${c.desc}: Got ${result}`);
        } else {
            console.error(`❌ [isoToDateString] ${c.desc}: Expected ${c.expected}, got ${result}`);
        }
    });

    // Test parseDate
    const parseCases = [
        { input: '2026-01-17', desc: 'YYYY-MM-DD string' },
        { input: '2026-01-17T00:00:00Z', desc: 'ISO string' },
    ];

    parseCases.forEach(c => {
        const result = parseDate(c.input);
        if (result && result.getFullYear() === 2026 && result.getMonth() === 0 && result.getDate() === 17) {
            console.log(`✅ [parseDate] ${c.desc}: Correctly parsed to Jan 17, 2026 (local)`);
        } else {
            console.error(`❌ [parseDate] ${c.desc}: Failed or incorrect date. Got: ${result}`);
        }
    });

    // Test getTodayISO
    const todayISO = getTodayISO();
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const manualToday = `${year}-${month}-${day}`;

    if (todayISO === manualToday) {
        console.log(`✅ [getTodayISO]: Got ${todayISO} (matches local date)`);
    } else {
        // Caution: this might fail if run exactly at midnight, but usually it should pass
        console.warn(`⚠️ [getTodayISO]: Got ${todayISO}, manual calc: ${manualToday}. This might be expected if run near midnight.`);
    }
}

try {
    test();
} catch (e) {
    console.error('Test script crashed:', e);
}
