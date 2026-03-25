'use strict'
require('../_alias.js');

const { fork } = require('child_process');
const { pointsGenerator } = require('@root/script/server_sim/data.js')

const child = fork('server.js');
child.send(pointsGenerator(
    1, 1, 1, 1, 1, // analog
    1, 1, 1, 1, 1, // binary
    1, 1, 1, 1, 1, // multistate
    1, 1, // proprietary
    // 100, 50, 50, 50, 50, // analog
    // 100, 50, 50, 50, 50, // binary
    // 100, 50, 50, 50, 50, // multistate
    // 50, 50, // proprietary
));
//0, 0, 0, 0, 0,
const timeoutMs = 1000000000; // 10 seconds

const timeout = setTimeout(() => {
    console.log('Timeout reached. Killing child process.');
    child.kill('SIGTERM');
}, timeoutMs);

child.on('exit', (code, signal) => {
    clearTimeout(timeout);
    console.log(`Child process exited with code ${code} and signal ${signal}`);
});