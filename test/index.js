require("source-map-support/register");
const cluster = require("cluster");
const awaiter = require("tslib").__awaiter;
const assert = require("assert");
const { createInstance } = require("..");

var worker;
var ins = createInstance(2999);

class MyService {
    sum(a, b) {
        return awaiter(this, void 0, void 0, function* () {
            return a + b;
        });
    }

    getPid() {
        return awaiter(this, void 0, void 0, function* () {
            return process.pid;
        });
    }

    throw() {
        return awaiter(this, void 0, void 0, function* () {
            throw new TypeError("test error");
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
    let srv;
    try {
        if (cluster.isMaster) {
            ins.register(MyService);
            yield ins.start();
            worker = cluster.fork();
        } else {
            srv = yield ins.connect(MyService);

            assert.strictEqual(yield srv.sum(12, 13), 25);
            assert.strictEqual(yield srv.getPid(), process.ppid);
            yield srv.throw();
            yield srv.exit();
        }
    } catch (err) {
        assert.ok(err instanceof TypeError);
        assert.strictEqual(err.message, "test error");
        srv && (yield srv.exit());
    }
});