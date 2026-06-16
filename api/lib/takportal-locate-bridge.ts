import { fetch } from 'undici';
import Err from '@openaddresses/batch-error';
import type { InferSelectModel } from 'drizzle-orm';
import type { Profile } from './schema.js';

const LOCATE_API_PREFIX = '/api/locate';
const REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

/** Paths under /api/locate allowed through the bridge (locator plugin surface). */
const ALLOWED_SUBPATH = /^\/locators(?:\/[^/]+(?:\/(?:archive|reactivate|manual-ping|history|send-link-sms))?)?$/;

export function getTakPortalPublicOrigin(): string | null {
    const raw = String(process.env.TAK_PORTAL_PUBLIC_URL || '').trim();
    if (!raw) return null;
    try {
        const u = new URL(raw);
        return u.origin;
    } catch {
        return null;
    }
}

export function applyPublicUrlForwardedHeaders(headers: Record<string, string>): void {
    const raw = String(process.env.TAK_PORTAL_PUBLIC_URL || '').trim();
    if (!raw) return;
    try {
        const u = new URL(raw);
        headers['X-Forwarded-Proto'] = u.protocol.replace(':', '') || 'https';
        headers['X-Forwarded-Host'] = u.host;
        headers.Host = u.host;
    } catch {
        /* ignore invalid URL */
    }
}

export function getTakPortalInternalBase(): string {
    return (process.env.TAK_PORTAL_INTERNAL_URL || 'http://tak-portal:3000').replace(/\/$/, '');
}

export function assertAllowedLocateSubpath(subpath: string): string {
    const normalized = subpath.startsWith('/') ? subpath : `/${subpath}`;
    const pathOnly = normalized.split('?')[0];

    if (!ALLOWED_SUBPATH.test(pathOnly)) {
        throw new Err(404, null, 'TAK Portal locate API path is not allowed');
    }

    return normalized;
}

export function buildAuthentikHeaders(profile: InferSelectModel<typeof Profile>): Record<string, string> {
    const groups: string[] = [];

    const globalGroup = String(process.env.TAK_PORTAL_BRIDGE_GLOBAL_GROUP || '').trim();
    if (profile.system_admin && globalGroup) {
        groups.push(globalGroup);
    }

    for (const entry of String(process.env.TAK_PORTAL_BRIDGE_EXTRA_GROUPS || '').split(/[,;|]/)) {
        const g = entry.trim();
        if (g) groups.push(g);
    }

    const username = String(profile.username || '').trim();
    if (!username) {
        throw new Err(400, null, 'CloudTAK profile username is required for TAK Portal bridge');
    }

    return {
        'Accept': 'application/json',
        'X-Authentik-Username': username,
        'X-Authentik-Email': username,
        'X-Authentik-Name': username,
        'X-Authentik-Groups': [...new Set(groups)].join(';'),
    };
}

export async function forwardTakPortalLocateRequest(input: {
    method: string;
    subpath: string;
    query?: Record<string, unknown>;
    body?: unknown;
    contentType?: string;
    profile: InferSelectModel<typeof Profile>;
}): Promise<{ status: number; contentType: string | null; body: string }> {
    const method = String(input.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
        throw new Err(405, null, 'Method not allowed');
    }

    const subpath = assertAllowedLocateSubpath(input.subpath);
    const url = new URL(`${getTakPortalInternalBase()}${LOCATE_API_PREFIX}${subpath}`);

    for (const [key, value] of Object.entries(input.query || {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) url.searchParams.append(key, String(item));
        } else {
            url.searchParams.set(key, String(value));
        }
    }

    const headers = buildAuthentikHeaders(input.profile);
    applyPublicUrlForwardedHeaders(headers);
    if (input.contentType) {
        headers['Content-Type'] = input.contentType;
    }

    let body: string | undefined;
    if (method !== 'GET' && method !== 'DELETE' && input.body !== undefined) {
        body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
        if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
    }

    const response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.text(),
    };
}
