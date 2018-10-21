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

    sum(a, b) {
        return awaiter(this, void 0, void 0, function* () {
            return a + b;
        });
    }

    getId() {
        return awaiter(this, void 0, void 0, function* () {
            return this.id;
        });
    }

    getPid() {
        return awaiter(this, void 0, void 0, function* () {
            return process.pid;
        });
    }

    exit() {
        return awaiter(this, void 0, void 0, function* () {
            worker.kill();
            yield ins.close();
            console.log("#### OK ####");
        });
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