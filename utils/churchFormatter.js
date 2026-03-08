/**
 * churchFormatter.js
 *
 * Single source of truth for all Church data transformation and derived-field
 * computation.  Every API response that returns a Church document MUST pass
 * through formatChurchResponse() so the frontend receives a consistent,
 * enriched shape and never has to derive anything itself.
 *
 * Rules:
 *  - All string normalization (phone, website, address) happens here.
 *  - All derived/computed fields (formattedAddress, locationShort, primaryPastor,
 *    section presence flags, outreach labels) are added here.
 *  - Null-defaults with business meaning ('Contact for details', etc.) live here.
 *  - The frontend may only display what the API returns; it must not derive data.
 */

'use strict';

// ---------------------------------------------------------------------------
// Outreach label map — backend owns the enum; frontend just renders the string
// ---------------------------------------------------------------------------
const OUTREACH_LABELS = {
  food_assistance: 'Food Assistance',
  clothing: 'Clothing',
  health_services: 'Health Services',
  education: 'Education',
  disaster_relief: 'Disaster Relief',
  community_development: 'Community Development',
  family_services: 'Family Services',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a URL starts with a scheme.  Applied at save-time (normalizeChurchInput)
 * and again here as a safety net.
 */
function normalizeWebsite(website) {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;
}

/**
 * Collapse multiple whitespace characters in a phone number to single spaces.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\s+/g, ' ').trim() || null;
}

/**
 * Build a full address string from address sub-document.
 * Returns null when no address parts exist.
 */
function buildFormattedAddress(address) {
  if (!address) return null;
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Build a short "City, State" location string.
 */
function buildLocationShort(address) {
  if (!address) return null;
  const parts = [address.city, address.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Extract the primary pastor from the leadership sub-document.
 * The first entry in associatePastors is treated as the lead pastor.
 */
function extractPrimaryPastor(leadership) {
  if (!leadership?.associatePastors?.length) return null;
  const p = leadership.associatePastors[0];
  return {
    name: p.name || null,
    title: p.title || null,
    phone: normalizePhone(p.phone),
    email: p.email || null,
    responsibilities: p.responsibilities || [],
  };
}

/**
 * Resolve the conference from a populated or raw conferenceId field.
 * Always returns { _id, name, code } or null.
 */
function resolveConference(conferenceId) {
  if (!conferenceId) return null;
  if (typeof conferenceId === 'object') {
    return {
      _id: conferenceId._id ? String(conferenceId._id) : null,
      name: conferenceId.name || null,
      code: conferenceId.code || null,
    };
  }
  // Unpopulated — only the ID is available
  return { _id: String(conferenceId), name: null, code: null };
}

/**
 * Map raw outreach focus array to labelled objects.
 */
function mapOutreachFocus(primaryFocus) {
  if (!Array.isArray(primaryFocus)) return [];
  return primaryFocus.map((key) => ({
    key,
    label: OUTREACH_LABELS[key] || key,
  }));
}

// ---------------------------------------------------------------------------
// Section presence flags
// Computed here so the frontend never has to inspect nested arrays/booleans.
// ---------------------------------------------------------------------------
function computePresenceFlags(church) {
  const services = church.services || {};
  const facilities = church.facilities || {};
  const leadership = church.leadership || {};
  const outreach = church.outreach || {};

  const specialServices = services.special || [];
  const classrooms = facilities.classrooms || [];
  const pastors = leadership.associatePastors || [];
  const outreachFocus = outreach.primaryFocus || [];

  return {
    hasServiceTimes: Boolean(
      services.sabbathSchool ||
        services.worship ||
        services.prayerMeeting ||
        services.vespers ||
        specialServices.length > 0
    ),
    hasFacilities: Boolean(
      facilities.sanctuary ||
        classrooms.length > 0 ||
        facilities.kitchen?.available ||
        facilities.parking
    ),
    hasLeadership: Boolean(
      pastors.length > 0 ||
        leadership.firstElder ||
        leadership.acsCoordinator ||
        leadership.clerk ||
        leadership.treasurer
    ),
    hasOutreach: Boolean(outreachFocus.length > 0 || outreach.serviceArea),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * normalizeChurchInput(body)
 *
 * Called at CREATE and UPDATE time.  Mutates a shallow copy of the request
 * body to ensure persisted data is always normalised (phone, website).
 * Returns the normalised copy.
 */
function normalizeChurchInput(body) {
  const out = { ...body };

  // Normalize contact fields
  if (out.contact) {
    out.contact = { ...out.contact };
    if (out.contact.phone !== undefined)
      out.contact.phone = normalizePhone(out.contact.phone);
    if (out.contact.website !== undefined)
      out.contact.website = normalizeWebsite(out.contact.website);
  }

  // Normalize nested leader phone numbers
  if (out.leadership) {
    out.leadership = { ...out.leadership };

    const normalizeLeader = (leader) =>
      leader ? { ...leader, phone: normalizePhone(leader.phone) } : leader;

    if (Array.isArray(out.leadership.associatePastors)) {
      out.leadership.associatePastors =
        out.leadership.associatePastors.map(normalizeLeader);
    }
    ['firstElder', 'acsCoordinator', 'clerk', 'treasurer'].forEach((role) => {
      if (out.leadership[role])
        out.leadership[role] = normalizeLeader(out.leadership[role]);
    });
  }

  return out;
}

/**
 * formatChurchResponse(church)
 *
 * Enriches a raw Mongoose document (or lean object) with computed / derived
 * fields before it is serialised and sent to the client.
 *
 * Returns a plain object — the original document is never mutated.
 */
function formatChurchResponse(church) {
  // Support both Mongoose documents and lean objects
  const raw =
    typeof church.toObject === 'function' ? church.toObject() : church;

  const address = raw.location?.address || null;
  const contact = raw.contact || {};
  const leadership = raw.leadership || {};
  const outreach = raw.outreach || {};
  const services = raw.services || {};
  const metadata = raw.metadata || {};

  const conference = resolveConference(raw.conferenceId);

  // Normalize contact at read-time too (defensive — data may pre-date normalisation)
  const phone = normalizePhone(contact.phone);
  const website = normalizeWebsite(contact.website);

  // Special services — ensure it's always an array
  const specialServices = Array.isArray(services.special)
    ? services.special
    : [];

  // Outreach with labels
  const outreachFocus = mapOutreachFocus(outreach.primaryFocus);

  return {
    // ── Core identity ──────────────────────────────────────────────────────
    _id: String(raw._id),
    name: raw.name || null,
    code: raw.code || null,
    isActive: raw.isActive ?? true,
    organizedDate: raw.organizedDate || null,
    hierarchyPath: raw.hierarchyPath || null,
    hierarchyLevel: raw.hierarchyLevel ?? 2,

    // ── Conference (always a consistent shape, never a raw ObjectId) ───────
    conference,

    // ── Location ───────────────────────────────────────────────────────────
    location: {
      address: address
        ? {
            street: address.street || null,
            city: address.city || null,
            state: address.state || null,
            postalCode: address.postalCode || null,
            country: address.country || null,
          }
        : null,
      coordinates: raw.location?.coordinates
        ? {
            latitude: raw.location.coordinates.latitude,
            longitude: raw.location.coordinates.longitude,
          }
        : null,
    },

    // ── Computed location strings (frontend must not derive these) ─────────
    formattedAddress: buildFormattedAddress(address) || 'Address not available',
    locationShort: buildLocationShort(address) || 'Location not available',

    // ── Contact (normalised, with UI-safe defaults) ────────────────────────
    contact: {
      phone: phone || null,
      email: contact.email || null,
      website: website || null,
      // UI-safe fallbacks — frontend renders these directly
      phoneDisplay: phone || 'Contact for details',
      websiteDisplay: website || null,
    },

    // ── Google Maps directions URL ─────────────────────────────────────────
    directionsUrl: raw.location?.coordinates
      ? `https://www.google.com/maps/search/?api=1&query=${raw.location.coordinates.latitude},${raw.location.coordinates.longitude}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(buildFormattedAddress(address) || '')}`
        : null,

    // ── Leadership ─────────────────────────────────────────────────────────
    leadership: {
      primaryPastor: extractPrimaryPastor(leadership),
      associatePastors: (leadership.associatePastors || []).map((p, i) => ({
        ...p,
        phone: normalizePhone(p.phone),
        isPrimary: i === 0,
      })),
      firstElder: leadership.firstElder
        ? {
            ...leadership.firstElder,
            phone: normalizePhone(leadership.firstElder.phone),
          }
        : null,
      acsCoordinator: leadership.acsCoordinator
        ? {
            ...leadership.acsCoordinator,
            phone: normalizePhone(leadership.acsCoordinator.phone),
          }
        : null,
      clerk: leadership.clerk
        ? { ...leadership.clerk, phone: normalizePhone(leadership.clerk.phone) }
        : null,
      treasurer: leadership.treasurer
        ? {
            ...leadership.treasurer,
            phone: normalizePhone(leadership.treasurer.phone),
          }
        : null,
    },

    // ── Services ───────────────────────────────────────────────────────────
    services: {
      sabbathSchool: services.sabbathSchool || null,
      worship: services.worship || null,
      prayerMeeting: services.prayerMeeting || null,
      vespers: services.vespers || null,
      special: specialServices,
    },

    // ── Facilities ─────────────────────────────────────────────────────────
    facilities: {
      sanctuary: raw.facilities?.sanctuary || null,
      classrooms: raw.facilities?.classrooms || [],
      kitchen: raw.facilities?.kitchen || null,
      parking: raw.facilities?.parking || null,
      other: raw.facilities?.other || [],
    },

    // ── Outreach (with human-readable labels from backend) ─────────────────
    outreach: {
      primaryFocus: outreachFocus,
      serviceArea: outreach.serviceArea || null,
      partnerships: outreach.partnerships || [],
    },

    // ── Image ──────────────────────────────────────────────────────────────
    primaryImage: raw.primaryImage || null,

    // ── Section presence flags ─────────────────────────────────────────────
    // Frontend uses these booleans to decide which sections to render.
    sections: computePresenceFlags(raw),

    // ── Stats (always numbers, never null) ─────────────────────────────────
    stats: {
      teamCount: metadata.teamCount || 0,
      serviceCount: metadata.serviceCount || 0,
    },

    // ── Settings ───────────────────────────────────────────────────────────
    settings: raw.settings || null,

    // ── Timestamps ─────────────────────────────────────────────────────────
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * formatChurchListItem(church)
 *
 * Lightweight version used by the paginated list endpoint.
 * Only includes fields the list table needs — keeps the payload small.
 */
function formatChurchListItem(church) {
  const raw =
    typeof church.toObject === 'function' ? church.toObject() : church;
  const address = raw.location?.address || null;
  const contact = raw.contact || {};

  return {
    _id: String(raw._id),
    name: raw.name || null,
    code: raw.code || null,
    isActive: raw.isActive ?? true,
    conference: resolveConference(raw.conferenceId),
    locationShort: buildLocationShort(address) || null,
    location: {
      address: address
        ? {
            street: address.street || null,
            city: address.city || null,
            state: address.state || null,
            postalCode: address.postalCode || null,
          }
        : null,
    },
    contact: {
      phone: normalizePhone(contact.phone) || null,
      email: contact.email || null,
      website: normalizeWebsite(contact.website) || null,
    },
    stats: {
      teamCount: raw.metadata?.teamCount || 0,
      serviceCount: raw.metadata?.serviceCount || 0,
    },
  };
}

module.exports = {
  formatChurchResponse,
  formatChurchListItem,
  normalizeChurchInput,
};
