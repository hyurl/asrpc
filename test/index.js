require("source-map-support/register");
const cluster = require("cluster");
const awaiter = require("tslib").__awaiter;
const assert = require("assert");
const { createInstance } = require("..");

var worker;
var ins = createInstance(2018);

class MyService {
    constructor(id) {
        this.id = id;
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

    getDate() {
        return awaiter(this, void 0, void 0, function* () {
            return new Date();
        });
    }

    getStrWithLineEndings() {
        return awaiter(this, void 0, void 0, function* () {
            return "hello\r\n\r\nworld";
        });
    }

    throw() {
        return awaiter(this, void 0, void 0, function* () {
            throw new TypeError("test error");
        });
    }

    exit(code) {
        return awaiter(this, void 0, void 0, function* () {
            worker.kill();
            yield ins.close();
            if (!code)
                console.log("#### OK ####");
            else
                process.exit(code);
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
            srv = yield ins.connect(MyService, "my.service");

            assert.strictEqual(yield srv.sum(12, 13), 25);
            assert.strictEqual(yield srv.getId(), "my.service");
            if (parseFloat(process.version) >= 8.10) {
                assert.strictEqual(yield srv.getPid(), process.ppid);
            }
            assert.ok((yield srv.getDate()) instanceof Date);
            assert.strictEqual((yield srv.getStrWithLineEndings()), "hello\r\n\r\nworld");
            yield srv.throw();
            yield srv.exit();
        }
    } catch (err) {
        try {
            assert.ok(err instanceof TypeError);
            assert.strictEqual(err.message, "test error");
            srv && (yield srv.exit());
        } catch (err) {
            console.log(err);
            srv && (yield srv.exit(1));
        }
    }
});