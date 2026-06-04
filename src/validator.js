import {
    ACTION_GROUP_LABELS,
    AGE_LABELS,
    ALL_ACTION_LABELS,
    APPEARANCE_DETAIL_LABELS,
    ATTIRE_LABELS,
    CLOTHING_STATE_LABELS,
    CONSENT_LABELS,
    CONTACT_LABELS,
    CONTENT_LABELS,
    EXPOSURE_LABELS,
    FLUID_LABELS,
    FLUID_LOCATION_LABELS,
    NSFW_STATE_LABELS,
    POSE_LABELS,
    RISK_LABELS,
    ROUTE_LABELS,
} from './labels.js';

function toSet(values) {
    return values instanceof Set ? values : new Set(values);
}

export function normalizeAllowed(value, allowed, fallback = 'unknown') {
    if (!value || typeof value !== 'string') {
        return fallback;
    }

    const clean = value.trim().toLowerCase();
    return toSet(allowed).has(clean) ? clean : fallback;
}

export function normalizeRouterResult(fields) {
    if (!fields || typeof fields !== 'object') {
        return null;
    }

    return {
        content: normalizeAllowed(fields.content, CONTENT_LABELS),
        route: normalizeAllowed(fields.route, ROUTE_LABELS),
        reason: typeof fields.reason === 'string' && fields.reason.trim()
            ? fields.reason.trim().toLowerCase()
            : 'unknown',
    };
}

export function normalizeNormalizedTags(tags) {
    if (!tags || typeof tags !== 'object') {
        return null;
    }

    const location = typeof tags.location === 'string' && tags.location.trim()
        ? tags.location.trim().toLowerCase()
        : 'unknown';
    const setting = typeof tags.setting === 'string' && tags.setting.trim()
        ? tags.setting.trim().toLowerCase()
        : 'unknown';

    return {
        content: normalizeAllowed(tags.content, CONTENT_LABELS),
        action_group: normalizeAllowed(tags.action_group ?? tags['action group'], ACTION_GROUP_LABELS),
        action: normalizeAllowed(tags.action, ALL_ACTION_LABELS),
        pose: normalizeAllowed(tags.pose, POSE_LABELS),
        exposure: normalizeAllowed(tags.exposure, EXPOSURE_LABELS),
        contact: normalizeAllowed(tags.contact, CONTACT_LABELS),
        state: normalizeAllowed(tags.state, NSFW_STATE_LABELS, 'none'),
        appearance_detail: normalizeAllowed(tags.appearance_detail ?? tags['appearance detail'], APPEARANCE_DETAIL_LABELS, 'none'),
        fluid: normalizeAllowed(tags.fluid, FLUID_LABELS, 'none'),
        fluid_location: normalizeAllowed(tags.fluid_location ?? tags['fluid location'], FLUID_LOCATION_LABELS, 'none'),
        location,
        attire: normalizeAllowed(tags.attire, ATTIRE_LABELS),
        clothing_state: normalizeAllowed(tags.clothing_state ?? tags['clothing state'], CLOTHING_STATE_LABELS, 'normal'),
        setting,
    };
}

export function validateNormalizedTags(tags) {
    const normalized = normalizeNormalizedTags(tags);
    if (!normalized) {
        return false;
    }

    return Boolean(
        CONTENT_LABELS.includes(normalized.content) &&
        ACTION_GROUP_LABELS.includes(normalized.action_group) &&
        ALL_ACTION_LABELS.includes(normalized.action) &&
        POSE_LABELS.includes(normalized.pose) &&
        EXPOSURE_LABELS.includes(normalized.exposure) &&
        CONTACT_LABELS.includes(normalized.contact) &&
        NSFW_STATE_LABELS.includes(normalized.state) &&
        APPEARANCE_DETAIL_LABELS.includes(normalized.appearance_detail) &&
        FLUID_LABELS.includes(normalized.fluid) &&
        FLUID_LOCATION_LABELS.includes(normalized.fluid_location) &&
        ATTIRE_LABELS.includes(normalized.attire) &&
        CLOTHING_STATE_LABELS.includes(normalized.clothing_state) &&
        normalized.location &&
        normalized.setting
    );
}

export function normalizeSafetyTags(tags) {
    if (!tags || typeof tags !== 'object') {
        return null;
    }

    return {
        age: normalizeAllowed(tags.age, AGE_LABELS),
        consent: normalizeAllowed(tags.consent, CONSENT_LABELS),
        risk: normalizeAllowed(tags.risk, RISK_LABELS),
        reason: typeof tags.reason === 'string' && tags.reason.trim()
            ? tags.reason.trim().toLowerCase()
            : 'unknown',
    };
}

export function validateSafetyTags(tags) {
    const normalized = normalizeSafetyTags(tags);
    if (!normalized) {
        return false;
    }

    return Boolean(
        AGE_LABELS.includes(normalized.age) &&
        CONSENT_LABELS.includes(normalized.consent) &&
        RISK_LABELS.includes(normalized.risk)
    );
}
