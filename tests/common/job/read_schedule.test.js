'use strict';

const bacnet = require('@root/ext/node-bacstack/dist/index.js');
const EventEmitter = require('events');

// @ts-expect-error
// eslint-disable-next-line
const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, it, test } = require('@jest/globals');

const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js');
const { ReadScheduleJob } = require('@root/common/job/read_schedule.js');
const { serverConfig } = require('@root/tests/_test_lib/data.js');
const { EG_BACNET_DEVICES, EG_BACNET_POINTS } = require('@root/common/example');
const {
    ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME,
    ERR_POINT_NOT_ATTACHED_TO_DEVICE
} = require('@root/common/core/constant.js');

// ---------------------------------- constants ----------------------------------
const SCHEDULE_TYPE = 17
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 500,
    interface: '0.0.0.0',
    port: 47808,
    broadcastAddress: '127.0.0.255:47809',
}
const deviceSingle = [{
    "deviceName": serverConfig.deviceName,
    "deviceId": serverConfig.deviceId,
    "network": null,
    "ipAddress": "127.0.0.1:47809",
    "macAddress": null,
    "segmentation": serverConfig.segmentation,
    "maxApdu": serverConfig.maxApdu,
    "vendorId": serverConfig.vendorId,
}]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const schedulePoint = (instance, name = `Schedule ${instance}`, overrides = {}) => ({
    "deviceName": serverConfig.deviceName,
    "pointName": name,
    "bacType": SCHEDULE_TYPE,
    "bacInstance": instance,
    "bacProp": 85,
    "value": false,
    "valueType": 1,
    "facets": "",
    "priority": 0,
    ...overrides
})

// Monday to Friday 08:00 -> value, 17:00 -> null, weekend empty
const weeklyMonToFri = (value) => DAYS.map((day, i) => ({
    day,
    timeValues: i < 5 ? [{ time: '08:00:00', value }, { time: '17:00:00', value: null }] : []
}))

// ---------------------------------- test ----------------------------------
describe(`${ReadScheduleJob.name} tests`, () => {
    let client = null
    let progress = 0
    let result = null
    let error = null
    let errorAll = []

    // devices defaults to deviceSingle only when not passed (an explicit undefined must reach the job)
    const run = async (points, ...rest) => {
        const devices = rest.length ? rest[0] : deviceSingle
        progress = null
        result = null
        error = null
        errorAll = []
        const job = new ReadScheduleJob(client, eventEmitter, { devices, points }, 1, 5);
        await job.execute();
        // @ts-ignore
        return result?.payload
    }

    beforeAll(() => {
        client = new bacnet.Client({
            apduTimeout: config.apduTimeout,
            interface: config.interface,
            port: config.port,
            broadcastAddress: config.broadcastAddress,
        });
    });

    afterAll(() => {
        eventEmitter.removeAllListeners();
        if (client)
            client.close()
    });

    // ---------------------------------- validation ----------------------------------
    it.each([
        [true],
        [123],
        ['hello'],
        [null],
        [undefined],
        [{ 'hello': 'world' }],
    ])('invalid device format', async (devices) => {
        await run([schedulePoint(0)], devices);

        expect(progress).toBe(100);
        expect(error).toStrictEqual({
            [`[read schedule] ${ERR_INVALID_DATA_TYPE}`]: {
                devices: devices,
                expected: 'array',
                example: EG_BACNET_DEVICES
            }
        });
    });

    it.each([
        [true],
        [123],
        ['hello'],
        [null],
        [undefined],
        [{ 'hello': 'world' }],
    ])('invalid point format', async (points) => {
        await run(points);

        expect(progress).toBe(100);
        expect(error).toStrictEqual({
            [`[read schedule] ${ERR_INVALID_DATA_TYPE}`]: {
                points: points,
                expected: 'array',
                example: EG_BACNET_POINTS
            }
        });
    });

    it.each([
        [{ ...deviceSingle[0], network: -1 }], // invalid network
        [{ ...deviceSingle[0], network: 1, ipAddress: '127.0.0.1889' }], // invalid ip address
    ])('device schema validation error', async (device) => {
        await run([schedulePoint(0)], [device]);

        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        expect(error[`[read schedule] ${ERR_SCHEMA_VALIDATION} (devices)`]).not.toBeUndefined();
    });

    test('duplicate device name', async () => {
        await run([schedulePoint(0)], [{ ...deviceSingle[0] }, { ...deviceSingle[0] }]);

        expect(progress).toBe(100);
        expect(errorAll.find(obj => obj[`[read schedule] ${ERR_DUPLICATED_DEVICE_NAME}`])).not.toBeUndefined();
    });

    it.each([
        [{ ...schedulePoint(0), bacType: undefined }], // missing bacType
        [{ ...schedulePoint(0), bacProp: 'happy' }], // invalid bacProp
    ])('point schema validation error', async (point) => {
        await run([point]);

        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        expect(error[`[read schedule] ${ERR_SCHEMA_VALIDATION} (points)`]).not.toBeUndefined();
    });

    test('point not attached to device', async () => {
        await run([schedulePoint(0, 'Orphan', { deviceName: 'Orphan Device' })]);

        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        expect(error[`[read schedule] ${ERR_POINT_NOT_ATTACHED_TO_DEVICE}`]).not.toBeUndefined();
    });

    // ---------------------------------- reading ----------------------------------
    test('non schedule points are ignored', async () => {
        const payload = await run([{ ...schedulePoint(0), bacType: 0, pointName: 'Analog Input 0' }]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toStrictEqual([]);
    }, 10000);

    test('read not existent device', async () => {
        const payload = await run(
            [schedulePoint(0)],
            [{ ...deviceSingle[0], ipAddress: '192.168.1.133', network: 1 }]
        );

        expect(progress).toBe(100);
        expect(payload).toHaveLength(1);
        expect(payload[0].presentValue).toBeNull();
        expect(payload[0].presentValueError).not.toBeNull();
        expect(payload[0].effectivePeriodError).not.toBeNull();
        expect(payload[0].scheduleDefaultError).not.toBeNull();
        expect(payload[0].weeklyScheduleError).not.toBeNull();
        expect(payload[0].weeklySchedule).toStrictEqual([]);
        expect(payload[0].exceptionScheduleError).not.toBeNull();
        expect(payload[0].exceptionSchedule).toStrictEqual([]);
    }, 20000);

    test('read good boolean schedule with every exception type', async () => {
        const payload = await run([schedulePoint(0, 'Good Boolean Schedule')]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        expect(payload[0]).toStrictEqual({
            deviceId: serverConfig.deviceId,
            deviceName: serverConfig.deviceName,
            pointName: 'Good Boolean Schedule',
            objectId: { type: SCHEDULE_TYPE, instance: 0 },
            presentValue: false,
            presentValueError: null,
            effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
            effectivePeriodError: null,
            scheduleDefault: false,
            scheduleDefaultError: null,
            weeklySchedule: weeklyMonToFri(true),
            weeklyScheduleError: null,
            exceptionSchedule: [
                {
                    period: {
                        calendarReference: {
                            type: 6,
                            typeName: 'CALENDAR',
                            instance: 0,
                            dates: [
                                { date: '2027-10-18' },
                                { dateRange: { start: '2027-12-24', end: '2027-12-26' } },
                                { weekNDay: { month: null, weekOfMonth: null, dayOfWeek: 7, dayName: 'Sunday' } },
                            ]
                        }
                    },
                    timeValues: [{ time: '12:30:00', value: false }],
                    eventPriority: 16
                },
                {
                    period: { weekNDay: { month: null, weekOfMonth: null, dayOfWeek: 7, dayName: 'Sunday' } },
                    timeValues: [{ time: '12:00:00', value: false }],
                    eventPriority: 16
                },
                {
                    period: { date: '2027-07-01' },
                    timeValues: [{ time: '05:30:00', value: false }],
                    eventPriority: 8
                },
                {
                    period: { dateRange: { start: '2027-03-01', end: '2027-03-05' } },
                    timeValues: [{ time: '09:00:00', value: true }, { time: '10:15:00', value: null }],
                    eventPriority: 1
                },
            ],
            exceptionScheduleError: null,
        });
    }, 10000);

    test('read good numeric schedule', async () => {
        const payload = await run([schedulePoint(1, 'Good Numeric Schedule', { valueType: 4 })]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        expect(s.presentValue).toBeCloseTo(21.5);
        expect(s.scheduleDefault).toBeCloseTo(16);
        expect(s.effectivePeriod).toStrictEqual({ start: '*', end: '*' });
        expect(s.weeklySchedule).toHaveLength(7);
        expect(s.weeklySchedule[0].timeValues[0].time).toBe('08:00:00');
        expect(s.weeklySchedule[0].timeValues[0].value).toBeCloseTo(21.5);
        expect(s.weeklySchedule[0].timeValues[1]).toStrictEqual({ time: '17:00:00', value: null });
        expect(s.weeklySchedule[5].timeValues).toStrictEqual([]);
        expect(s.exceptionSchedule).toStrictEqual([]);
        expect([
            s.presentValueError, s.effectivePeriodError, s.scheduleDefaultError,
            s.weeklyScheduleError, s.exceptionScheduleError
        ]).toStrictEqual([null, null, null, null, null]);
    }, 10000);

    test('read good string schedule', async () => {
        const payload = await run([schedulePoint(2, 'Good String Schedule', { valueType: 7 })]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        expect(s.presentValue).toBe('world');
        expect(s.scheduleDefault).toBe('idle');
        expect(s.weeklySchedule[0]).toStrictEqual({
            day: 'Monday',
            timeValues: [{ time: '08:00:00', value: 'hello' }, { time: '15:30:00', value: null }]
        });
        expect(s.weeklySchedule.slice(1).every(d => d.timeValues.length === 0)).toBe(true);
        expect(s.exceptionSchedule).toStrictEqual([]);
        expect(s.weeklyScheduleError).toBeNull();
        expect(s.exceptionScheduleError).toBeNull();
    }, 10000);

    test('read bad schedule with missing properties', async () => {
        const payload = await run([schedulePoint(3, 'Bad Missing Properties Schedule')]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        // present value exists, everything else is an unknown property
        expect(s.presentValue).toBe(true);
        expect(s.presentValueError).toBeNull();
        expect(s.effectivePeriod).toBeNull();
        expect(s.effectivePeriodError).not.toBeNull();
        expect(s.scheduleDefault).toBeNull();
        expect(s.scheduleDefaultError).not.toBeNull();
        expect(s.weeklySchedule).toStrictEqual([]);
        expect(s.weeklyScheduleError).not.toBeNull();
        expect(s.exceptionSchedule).toStrictEqual([]);
        expect(s.exceptionScheduleError).not.toBeNull();
    }, 10000);

    test('read bad schedule with unknown calendar reference', async () => {
        const payload = await run([schedulePoint(4, 'Bad Calendar Reference Schedule')]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        // the failing exception schedule must not affect the other properties
        expect(s.presentValue).toBe(false);
        expect(s.weeklySchedule).toStrictEqual(weeklyMonToFri(true));
        expect(s.weeklyScheduleError).toBeNull();
        expect(s.exceptionSchedule).toStrictEqual([]);
        expect(s.exceptionScheduleError).not.toBeNull();
    }, 10000);

    test('read bad schedule with undecodable exception period', async () => {
        const payload = await run([schedulePoint(5, 'Bad Period Schedule')]);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        expect(s.weeklySchedule).toStrictEqual(weeklyMonToFri(true));
        expect(s.exceptionScheduleError).toBeNull();
        expect(s.exceptionSchedule).toHaveLength(1);
        // unknown period is kept as raw, time values and priority are still decoded
        expect(s.exceptionSchedule[0].period.raw).not.toBeUndefined();
        expect(s.exceptionSchedule[0].timeValues).toStrictEqual([{ time: '12:00:00', value: false }]);
        expect(s.exceptionSchedule[0].eventPriority).toBe(16);
    }, 10000);

    test('read schedule object that does not exist', async () => {
        const payload = await run([schedulePoint(99, 'Missing Schedule')]);

        expect(progress).toBe(100);
        expect(payload).toHaveLength(1);

        const s = payload[0];
        expect(s.pointName).toBe('Missing Schedule');
        expect(s.presentValue).toBeNull();
        expect(s.presentValueError).not.toBeNull();
        expect(s.weeklySchedule).toStrictEqual([]);
        expect(s.weeklyScheduleError).not.toBeNull();
        expect(s.exceptionSchedule).toStrictEqual([]);
        expect(s.exceptionScheduleError).not.toBeNull();
    }, 10000);

    test('read multiple good and bad schedules keeps point order', async () => {
        const points = [
            schedulePoint(3, 'Bad Missing Properties Schedule'),
            schedulePoint(0, 'Good Boolean Schedule'),
            schedulePoint(99, 'Missing Schedule'),
            schedulePoint(2, 'Good String Schedule', { valueType: 7 }),
        ]
        const payload = await run(points);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(payload.map(p => p.pointName)).toStrictEqual(points.map(p => p.pointName));
        expect(payload.map(p => p.weeklyScheduleError === null)).toStrictEqual([false, true, false, true]);
    }, 20000);

    // ---------------------------------- events ----------------------------------
    eventEmitter.on(EVENT_OUTPUT, (data) => {
        result = data
    });

    eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
        progress = msg
    });

    eventEmitter.on(EVENT_ERROR, (err) => {
        error = err
        errorAll = [...errorAll, err]
    });
});

