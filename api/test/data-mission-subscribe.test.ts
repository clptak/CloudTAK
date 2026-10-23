import test from 'node:test';
import assert from 'node:assert';
import Sinon from 'sinon';
import DataMission from '../stateless/lib/data-mission.js';
import TAKServerControl from '../common/control/takserver.js';
import ConnectionControl from '../common/control/connection.js';
import type Config from '../common/config.js';

const UID = 'CN=connection-1';

/**
 * Run DataMission.sync for a Data Sync whose Mission already exists on the TAK Server,
 * recording the Mission calls made with the Connection's certificate
 */
async function sync(opts: { subscribed?: string[]; subscriptionsFail?: boolean; enabled?: boolean } = {}) {
    const calls = { subscribe: [] as unknown[], create: 0 };

    const api = {
        Group: { list: async () => ({ data: [{ name: 'CCSO Sworn', active: true }] }), update: async () => ({}) },
        Mission: {
            get: async () => ({ guid: 'mission-guid', name: 'Existing Mission' }),
            subscriptions: async () => {
                if (opts.subscriptionsFail) throw new Error('TAK Server unavailable');
                return { data: opts.subscribed ?? [] };
            },
            subscribe: async (name: string, query: unknown) => {
                calls.subscribe.push([name, query]);
                return {};
            },
            create: async () => {
                calls.create++;
                return { guid: 'new-guid' };
            },
            delete: async () => ({}),
        },
        MissionLayer: { list: async () => ({ data: [] }), create: async () => ({}) },
    };

    const asConnection = Sinon.stub(TAKServerControl.prototype, 'asConnection').resolves(api as never);
    const uid = Sinon.stub(ConnectionControl, 'uid').returns(UID);

    try {
        const config = {
            models: {
                Connection: { from: async () => ({ id: 1, enabled: opts.enabled ?? true, auth: { cert: 'cert', key: 'key' } }) },
                Data: { commit: async () => ({}) },
                Layer: { augmented_list: async () => ({ total: 0, items: [] }) },
            },
        } as unknown as Config;

        await DataMission.sync(config, {
            id: 1,
            name: 'Existing Mission',
            connection: 1,
            mission_sync: true,
            mission_diff: true,
            mission_guid: 'mission-guid',
            mission_token: null,
            mission_groups: [],
        } as never);
    } finally {
        asConnection.restore();
        uid.restore();
    }

    return calls;
}

test('DataMission.sync - subscribes the Connection to an existing Mission it attaches', async () => {
    const calls = await sync();

    assert.deepEqual(calls.subscribe, [['mission-guid', { uid: UID }]]);
    assert.equal(calls.create, 0);
});

test('DataMission.sync - an existing subscription is left alone', async () => {
    const calls = await sync({ subscribed: ['ANDROID-CloudTAK-someone', UID] });

    assert.deepEqual(calls.subscribe, []);
});

test('DataMission.sync - a failed subscription check never creates a second Mission', async () => {
    const calls = await sync({ subscriptionsFail: true });

    assert.deepEqual(calls.subscribe, []);
    assert.equal(calls.create, 0);
});

test('DataMission.sync - a disabled Connection is not subscribed', async () => {
    const calls = await sync({ enabled: false });

    assert.deepEqual(calls.subscribe, []);
});
