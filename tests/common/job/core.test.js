'use strict'

// eslint-disable-next-line
const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, it } = require('@jest/globals');

const { BaseJob, CoalescedJobQueue } = require('@root/common/job/core.js');
const {
    ERR_ONSTART_NOT_IMPLEMENTED, ERR_ONSTOP_NOT_IMPLEMENTED, ERR_EXECUTE_NOT_IMPLEMENTED
} = require('@root/common/core/constant.js');
const { delay } = require('@root/common/core/util.js');

// ---------------------------------- test ----------------------------------
describe('Core job tests', () => {
    beforeAll(() => {
    });

    afterAll(() => {
    });

    it('base job invalid instantiation', async () => {
        expect(() => {
            new BaseJob();
        }).toThrow(TypeError);
    });

    it('extended job throw method not implemented', async () => {
        class Job extends BaseJob { }
        const job = new Job();

        await expect(job.onStart())
            .rejects.toThrow(ERR_ONSTART_NOT_IMPLEMENTED)

        await expect(job.onStop())
            .rejects.toThrow(ERR_ONSTOP_NOT_IMPLEMENTED)

        await expect(job.execute())
            .rejects.toThrow(ERR_EXECUTE_NOT_IMPLEMENTED)
    });

    it('coalesced job queue', async () => {
        class Job extends BaseJob {
            async execute() {
                await delay(10);
            }
        }
        const job = new CoalescedJobQueue(10, false);
        job.run()

        expect(job.queue.length).toBe(0);

        job.addJob({
            id: 'job1',
            task: new Job()
        });


        job.addJob({
            id: 'job1',
            task: new Job()
        });

        // test coalesce
        expect(job.queue.length).toBe(1);

        job.addJob({
            id: 'job2',
            task: new Job()
        });

        // test different job
        expect(job.queue.length).toBe(2);

        await delay(100)

        // test job completion
        expect(job.queue.length).toBe(0);

        job.stop();
    });
});