const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
    sort(tests) {
        // Identify priority and least-priority files
        const priorityFile = tests.find(t => t.path.includes('func.test.js'));
        const leastPriorityFile = tests.find(t => t.path.includes('write_point.test.js'));
        const otherTests = tests.filter(
            t => t !== priorityFile && t !== leastPriorityFile
        );

        // Build the order: priority file first, then others, then least-priority
        const orderedTests = [];
        if (priorityFile) orderedTests.push(priorityFile);
        orderedTests.push(...otherTests);
        if (leastPriorityFile) orderedTests.push(leastPriorityFile);

        return orderedTests;
    }
}

module.exports = CustomSequencer;