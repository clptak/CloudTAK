import { Type } from '@sinclair/typebox';
import type { Response } from 'express';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { forwardTakPortalLocateRequest } from '../lib/takportal-locate-bridge.js';

type AuthRequest = Parameters<typeof Auth.as_profile>[1];

async function bridgeLocate(
    config: ConfigStateless,
    req: AuthRequest,
    res: Response,
    subpath: string,
): Promise<void> {
    const profile = await Auth.as_profile(config, req);
    const result = await forwardTakPortalLocateRequest({
        method: req.method,
        subpath,
        query: req.query as Record<string, unknown>,
        body: req.body,
        contentType: typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined,
        profile,
    });

    res.status(result.status);
    if (result.contentType) {
        res.setHeader('content-type', result.contentType);
    }
    res.send(result.body);
}

export default async function router(schema: Schema, config: ConfigStateless) {
    const common = {
        group: 'TAK Portal',
        description: 'Proxy locate API calls to internal TAK Portal using the CloudTAK user identity (no cross-origin browser auth).',
    };

    await schema.get('/takportal/locate/locators', {
        name: 'List locators',
        ...common,
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, '/locators');
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/takportal/locate/locators', {
        name: 'Create locator',
        ...common,
        body: Type.Any(),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, '/locators');
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/takportal/locate/locators/:id', {
        name: 'Update locator',
        ...common,
        params: Type.Object({ id: Type.String() }),
        body: Type.Any(),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/takportal/locate/locators/:id', {
        name: 'Delete locator',
        ...common,
        params: Type.Object({ id: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/takportal/locate/locators/:id/archive', {
        name: 'Archive locator',
        ...common,
        params: Type.Object({ id: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}/archive`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/takportal/locate/locators/:id/reactivate', {
        name: 'Reactivate locator',
        ...common,
        params: Type.Object({ id: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}/reactivate`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/takportal/locate/locators/:id/manual-ping', {
        name: 'Manual locator ping',
        ...common,
        params: Type.Object({ id: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}/manual-ping`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/takportal/locate/locators/:id/history', {
        name: 'Locator ping history',
        ...common,
        params: Type.Object({ id: Type.String() }),
        query: Type.Object({
            limit: Type.Optional(Type.Integer()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}/history`);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/takportal/locate/locators/:id/send-link-sms', {
        name: 'Send locator link SMS (TAK Portal SMS)',
        ...common,
        params: Type.Object({ id: Type.String() }),
        body: Type.Any(),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await bridgeLocate(config, req as AuthRequest, res, `/locators/${encodeURIComponent(req.params.id)}/send-link-sms`);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
