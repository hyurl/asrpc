require("source-map-support/register");
const { EventEmitter } = require("events");
const cluster = require("cluster");
const awaiter = require("tslib").__awaiter;
const assert = require("assert");
const { createInstance } = require("..");

var worker;
var ins = createInstance(2999);

class MyService extends EventEmitter {
    constructor() {
        super();
        this.id = 'my.service';
    }

    async sum(a, b) {
        return a + b;
    }

    async getId() {
        return this.id;
    }

    async getPid() {
        return process.pid;
    }

    async exit() {
        worker.kill();
        await ins.close();
        console.log("#### OK ####");
        // process.exit();
    }
}

awaiter(void 0, void 0, void 0, function* () {
    if (cluster.isMaster) {
        ins.register(MyService);
        yield ins.start();
        worker = cluster.fork();
    } else {
        let srv = yield ins.connect(MyService);

        assert.strictEqual(yield srv.sum(12, 13), 25);
        assert.strictEqual(yield srv.getId(), "my.service");
        assert.strictEqual(yield srv.getPid(), process.ppid);
        yield srv.exit();
    }
});