#!/usr/bin/env node
/**
 * Create one team under a church, then its services — the pattern for standing up a
 * new region.
 *
 * Written for North NSW, which has 91 churches and no teams at all, so its page reads
 * "No teams in North NSW yet". Doing 91 by hand through the panel is a long afternoon;
 * doing them from a script means the shape is right every time and the whole batch is
 * reviewable before anything is written.
 *
 * IT DOES NOT INVENT ANYTHING. The block below is a placeholder. Fill it with what a
 * church actually runs — the wrong details here become a promise of help on a public
 * website, which is worse than an empty page for someone who needs a food parcel.
 *
 * Order matters: a service requires a teamId, and churchId is derived from the team by
 * a pre-save hook, so the team must exist first. That is why this is one script rather
 * than two.
 *
 * Usage
 *   1. Sign in to the admin panel, open devtools, and copy the bearer token:
 *        localStorage.getItem('token')
 *   2. Edit PLAN below.
 *   3. Dry run first — prints exactly what it would send, writes nothing:
 *        API=https://api.communityservices.org.au TOKEN=<token> node migrations/createTeamWithServices.js
 *   4. When it looks right:
 *        API=... TOKEN=... APPLY=1 node migrations/createTeamWithServices.js
 *
 * It is deliberately not idempotent: running twice creates duplicates. Check the panel
 * before re-running.
 */

const API = process.env.API || 'http://localhost:5000';
const TOKEN = process.env.TOKEN;
const APPLY = process.env.APPLY === '1';

// ---------------------------------------------------------------------------
// REPLACE THIS with real details. `church` is matched by name against the
// existing records, so it must be exactly as it appears in the panel.
//
// `type` must be one of the values already in use:
//   cleaning, courses, food_pantry, gardening, health_program, home_help,
//   kids_club, lawn_care, moving_houses, odd_jobs, op_shop, pastoral_care,
//   yard_work
// ---------------------------------------------------------------------------
const PLAN = {
  church: 'CHURCH NAME EXACTLY AS IT APPEARS IN THE ADMIN',
  team: {
    name: 'PLACEHOLDER Team',
    type: 'community_service',
    description: 'What this team does, in a sentence.',
  },
  services: [
    {
      name: 'PLACEHOLDER Service',
      type: 'food_pantry',
      descriptionShort: 'One line shown on the service card.',
      descriptionLong:
        'The fuller description on the service page. Say who it is for and what ' +
        'actually happens, in plain language.',
      status: 'active',
    },
  ],
};
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers,
    },
  });

  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body.slice(0, 300) };
  }

  if (!res.ok) {
    throw new Error(
      `${options.method || 'GET'} ${path} -> ${res.status}\n     ${
        parsed.message || parsed.error || parsed.raw
      }`
    );
  }
  return parsed;
}

async function main() {
  if (!TOKEN)
    fail('TOKEN is required. See the usage note at the top of this file.');

  if (PLAN.church.startsWith('CHURCH NAME')) {
    fail(
      'PLAN is still the placeholder. Fill it in with real details before running —\n' +
        '  invented services would appear on the public site as offers of help.'
    );
  }

  console.log(`\n  API    : ${API}`);
  console.log(
    `  Mode   : ${APPLY ? 'APPLY (writes)' : 'dry run (writes nothing)'}\n`
  );

  // Resolve the church by name so the plan can be written in human terms.
  const churches = await api('/api/churches/public?limit=500');
  const matches = (churches.data || []).filter(
    (c) => (c.name || '').toLowerCase() === PLAN.church.toLowerCase()
  );

  if (matches.length === 0) fail(`No church named "${PLAN.church}".`);
  if (matches.length > 1)
    fail(
      `"${PLAN.church}" matches ${matches.length} churches. Disambiguate before running.`
    );

  const church = matches[0];
  console.log(`  Church : ${church.name} (${church._id})`);
  console.log(`  Team   : ${PLAN.team.name}`);
  PLAN.services.forEach((s) =>
    console.log(`   + service: ${s.name} [${s.type}]`)
  );

  if (!APPLY) {
    console.log(
      '\n  Dry run — nothing written. Re-run with APPLY=1 to create.\n'
    );
    return;
  }

  const team = await api('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ ...PLAN.team, churchId: church._id }),
  });
  const teamId = team.data?._id || team.team?._id || team._id;
  if (!teamId)
    fail(`Team created but no id came back: ${JSON.stringify(team)}`);
  console.log(`\n  created team ${teamId}`);

  for (const service of PLAN.services) {
    const created = await api('/api/admin/services', {
      method: 'POST',
      body: JSON.stringify({ ...service, teamId }),
    });
    const id = created.service?._id || created.data?._id;
    console.log(`  created service ${id}  ${service.name}`);
  }

  console.log('\n  Done. Check the panel, then the public site.\n');
}

main().catch((err) => fail(err.message));
