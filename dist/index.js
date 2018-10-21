"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs-extra");
const util_1 = require("./util");
const uuid = require("uuid/v4");
class ServiceInstance {
    constructor() {
        this.timeout = 5000;
        this.services = {};
        this.instances = {};
    }
    register(target) {
        this.services[util_1.findId(target)] = target;
    }
    deregister(target) {
        delete this.services[util_1.findId(target)];
    }
    start() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let server = net.createServer();
            if (this.path) {
                yield fs.ensureDir(path.dirname(this.path));
                if (yield fs.pathExists(this.path)) {
                    yield fs.unlink(this.path);
                }
                server.listen(this.path);
            }
            else {
                server.listen(this.port, this.host);
            }
            this.server = server;
            this.server.on("connection", socket => {
                socket.on("data", buf => {
                    for (let [event, ...data] of util_1.receive(buf)) {
                        socket.emit(event, ...data);
                    }
                }).on("error", err => {
                    if (!err.message.includes("socket has been ended")) {
                        console.log(err);
                    }
                }).on("rpc-connect", (srvId, id) => {
                    if (this.services[id]) {
                        this.instances[srvId] = new this.services[id];
                        socket.write(util_1.send("rpc-connected", srvId, id));
                    }
                    else {
                        let err = new Error(`service '${id}' not found`);
                        socket.write(util_1.send("rpc-connect-error", srvId, util_1.sendError(err)));
                    }
                }).on("rpc-disconnect", (srvId) => {
                    delete this.instances[srvId];
                }).on("rpc-request", (srvId, taskId, method, ...data) => {
                    let service = this.instances[srvId];
                    Promise.resolve().then(() => {
                        return service.before && service.before();
                    }).then(() => {
                        return service[method](...data);
                    }).then(res => {
                        return new Promise(resolve => {
                            socket.write(util_1.send("rpc-response", srvId, taskId, res), () => {
                                resolve();
                            });
                        });
                    }).then(() => {
                        return service.after && service.after();
                    }).catch(err => {
                        socket.write(util_1.send("rpc-error", srvId, taskId, util_1.sendError(err)));
                    });
                });
            });
            return this;
        });
    }
    close() {
        return new Promise(resolve => this.server.close(() => {
            this.server.unref();
            resolve();
        }));
    }
    connect(target) {
        return new Promise((resolve, reject) => {
            let connect = () => {
                if (!this.client) {
                    if (this.path) {
                        this.client = net.createConnection(this.path);
                    }
                    else {
                        this.client = net.createConnection(this.port, this.host);
                    }
                }
            };
            connect();
            if (this.client.connecting) {
                this.client.once("connect", () => {
                    resolve();
                }).once("error", err => {
                    reject(err);
                }).on("error", err => {
                    if (err.message.includes("socket has been ended")) {
                        this.client.unref();
                        let times = 0;
                        let reconnect = () => {
                            let timer = setTimeout(() => {
                                connect();
                                times++;
                                if (times === 5) {
                                    clearTimeout(timer);
                                }
                                else if (!this.client.destroyed || this.client.connecting) {
                                    clearTimeout(timer);
                                }
                                else {
                                    reconnect();
                                }
                            }, 50);
                        };
                    }
                }).on("data", buf => {
                    for (let [event, srvId, ...data] of util_1.receive(buf)) {
                        this.instances[srvId].emit(event, ...data);
                    }
                });
            }
            else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve, reject) => {
                let srv = new target;
                let srvId = srv[util_1.serviceId] = uuid();
                this.instances[srvId] = srv;
                this.client.write(util_1.send("rpc-connect", srvId, srv.id));
                srv.once("rpc-connected", () => {
                    resolve(util_1.proxify(srv, srvId, this));
                }).once("rpc-connect-error", (err) => {
                    err = util_1.receiveError(err);
                    reject(err);
                }).on("rpc-response", (taskId, res) => {
                    util_1.tasks[taskId].success(res);
                }).on("rpc-error", (taskId, err) => {
                    util_1.tasks[taskId].error(err);
                });
            });
        });
    }
    disconnect(srv) {
        return new Promise(resolve => {
            let srvId = srv[util_1.serviceId];
            delete this.instances[srvId];
            this.client.write(util_1.send("rpc-disconnect", srvId), () => {
                resolve();
            });
        });
    }
}
exports.ServiceInstance = ServiceInstance;
function createInstance() {
    let ins = new ServiceInstance;
    if (typeof arguments[0] == "string") {
        ins.path = arguments[0];
        if (!path.isAbsolute(ins.path)) {
            ins.path = path.resolve(os.tmpdir(), ".asrpc", ins.path);
        }
    }
    else {
        ins.port = arguments[0];
        ins.host = arguments[1];
    }
    return ins;
}
exports.createInstance = createInstance;
//# sourceMappingURL=index.js.map