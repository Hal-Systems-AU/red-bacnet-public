'use strict';

module.exports = async () => {
    console.log("Global teardown");

    // shutdown bacnet server
    const child = global.bacnetServer;

    if (child) {
        child.kill('SIGTERM'); // Send termination signal to the child process
        await new Promise((resolve, reject) => {
            child.once('exit', resolve); // Wait for the process to exit
            child.once('error', reject); // Handle errors if process doesn't exit properly
        });
    }
};
