import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth, { AuthUserAccess } from '../../common/auth.js';
import type ConfigStateless from '../config.js';

type SettingsRow = {
    channel: string;
    tak_portal_url: string;
};

async function ensureTable(config: ConfigStateless): Promise<void> {
    await config.pg.execute(sql`
        CREATE TABLE IF NOT EXISTS locator_portal_settings (
            id INTEGER PRIMARY KEY,
            channel TEXT NOT NULL,
            tak_portal_url TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function readSettings(config: ConfigStateless): Promise<{ channel: string; takPortalUrl: string }> {
    await ensureTable(config);
    const rows = await config.pg.execute(sql`
        SELECT channel, tak_portal_url FROM locator_portal_settings WHERE id = 1
    `) as unknown as SettingsRow[];
    const row = rows[0];
    return {
        channel: row ? String(row.channel || '').trim() : '',
        takPortalUrl: row ? String(row.tak_portal_url || '').trim() : '',
    };
}

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.get('/locator/settings', {
        name: 'Get locator portal settings',
        group: 'Locator',
        description: 'TAK Portal base URL and the TAK channel whose members may create locators.',
        res: Type.Object({
            channel: Type.String(),
            takPortalUrl: Type.String(),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            res.json(await readSettings(config));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.put('/locator/settings', {
        name: 'Save locator portal settings',
        group: 'Locator',
        description: 'Set the TAK Portal base URL for one TAK channel (system admin only).',
        body: Type.Object({
            channel: Type.String(),
            takPortalUrl: Type.String(),
        }),
        res: Type.Object({
            channel: Type.String(),
            takPortalUrl: Type.String(),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            if (user.access !== AuthUserAccess.ADMIN) {
                throw new Err(403, null, 'System admin access required');
            }

            const channel = String(req.body.channel || '').trim();
            const takPortalUrl = String(req.body.takPortalUrl || '').trim().replace(/\/+$/, '');
            if (!channel) throw new Err(400, null, 'Choose a TAK channel.');
            if (!takPortalUrl) throw new Err(400, null, 'Enter a TAK Portal Base URL.');

            await ensureTable(config);
            await config.pg.execute(sql`
                INSERT INTO locator_portal_settings (id, channel, tak_portal_url, updated_at)
                VALUES (1, ${channel}, ${takPortalUrl}, now())
                ON CONFLICT (id) DO UPDATE SET
                    channel = ${channel},
                    tak_portal_url = ${takPortalUrl},
                    updated_at = now()
            `);
            res.json({ channel, takPortalUrl });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
