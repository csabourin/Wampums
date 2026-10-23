#!/usr/bin/env node
/**
 * Put the demo unit back the way it was: the night reset.
 *
 * Visitors to the demo unit (demo_sign_in) may award points, take attendance
 * and award honors. Every night this restores those three tables from the
 * baseline in demo_sandbox_baselines (services/demoSandbox.js). No other unit
 * is ever touched: the script only finds units whose demo_sign_in is on.
 *
 * Usage, from the repository root, with DATABASE_URL in the environment or .env:
 *
 *   node scripts/demo/reset-demo-sandbox.js            restore every demo unit
 *   node scripts/demo/reset-demo-sandbox.js --dry-run  say what would be restored, change nothing
 *   node scripts/demo/reset-demo-sandbox.js --capture  make the current state the new baseline
 *   node scripts/demo/reset-demo-sandbox.js --only-at-midnight=America/Toronto
 *                                                      do nothing unless it is midnight there
 *
 * --only-at-midnight lets a cron that cannot set its own time zone run the
 * script every hour; it acts once a day, at local midnight, summer or winter.
 *
 * Exits 1 when the reset fails, with nothing changed.
 *
 * Crontab of the machine that holds the repository, midnight in Toronto:
 *
 *   # cronie (Fedora, RHEL, Arch) understands CRON_TZ:
 *   CRON_TZ=America/Toronto
 *   0 0 * * * cd /srv/wampums && node scripts/demo/reset-demo-sandbox.js >> /var/log/wampums-demo-reset.log 2>&1
 *
 *   # Debian/Ubuntu cron does not: run hourly and let the script pick the hour.
 *   0 * * * * cd /srv/wampums && node scripts/demo/reset-demo-sandbox.js --only-at-midnight=America/Toronto >> /var/log/wampums-demo-reset.log 2>&1
 */

'use strict';

const { Pool } = require('pg');
const { listDemoUnits, captureBaseline, restoreBaseline, lockSandbox } = require('../../services/demoSandbox');

const MIDNIGHT_FLAG = '--only-at-midnight=';

/**
 * @param {string[]} argv - Command-line arguments after the script name
 * @returns {{capture: boolean, dryRun: boolean, midnightZone: string|null}} Options
 */
function parseArguments(argv) {
  const known = new Set(['--capture', '--dry-run']);
  const midnightArgument = argv.find((argument) => argument.startsWith(MIDNIGHT_FLAG));
  const unknown = argv.filter((argument) => !known.has(argument) && argument !== midnightArgument);
  if (unknown.length) {
    throw new Error(`Unknown argument: ${unknown.join(' ')}`);
  }
  return {
    capture: argv.includes('--capture'),
    dryRun: argv.includes('--dry-run'),
    midnightZone: midnightArgument ? midnightArgument.slice(MIDNIGHT_FLAG.length) : null,
  };
}

/**
 * @param {string} timeZone - IANA time zone, e.g. America/Toronto
 * @param {Date} [now=new Date()] - Moment to check
 * @returns {boolean} Whether it is between midnight and 1 a.m. there
 */
function isMidnightIn(timeZone, now = new Date()) {
  const hour = new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(hour) === 0;
}

/**
 * Restore (or capture) every demo unit in one transaction.
 *
 * @param {Object} client - Database client
 * @param {{capture: boolean, dryRun: boolean}} options - What to do
 * @returns {Promise<Array<Object>>} One line of outcome per demo unit
 */
async function run(client, { capture, dryRun }) {
  await client.query('BEGIN');
  try {
    await lockSandbox(client);
    const outcomes = [];
    for (const organizationId of await listDemoUnits(client)) {
      /* eslint-disable no-await-in-loop -- one demo unit in practice; each runs in this transaction */
      if (capture) {
        await captureBaseline(client, organizationId, { replace: true });
        outcomes.push({ organizationId, captured: true });
      } else {
        const restored = await restoreBaseline(client, organizationId);
        outcomes.push({ organizationId, restored });
      }
      /* eslint-enable no-await-in-loop */
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return outcomes;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  require('dotenv').config({ quiet: true });
  const options = parseArguments(process.argv.slice(2));
  if (options.midnightZone && !isMidnightIn(options.midnightZone)) {
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured to reset the demo unit');
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
  const client = await pool.connect();
  try {
    const outcomes = await run(client, options);
    const prefix = `[demo-reset ${new Date().toISOString()}]${options.dryRun ? ' (dry run, nothing changed)' : ''}`;
    if (!outcomes.length) {
      console.log(`${prefix} No unit has demo_sign_in on; nothing to do.`);
    }
    for (const outcome of outcomes) {
      if (outcome.captured) {
        console.log(`${prefix} Unit ${outcome.organizationId}: baseline captured.`);
      } else if (!outcome.restored) {
        console.warn(`${prefix} Unit ${outcome.organizationId}: no baseline yet; run with --capture first. Left as is.`);
      } else {
        const { points, attendance, honors } = outcome.restored;
        console.log(`${prefix} Unit ${outcome.organizationId}: restored ${points} points, ${attendance} attendance, ${honors} honors.`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[demo-reset] Failed; nothing was changed:', error.message);
    process.exit(1);
  });
}

module.exports = { parseArguments, isMidnightIn, run };
