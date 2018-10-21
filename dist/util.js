"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uuid = require("uuid/v4");
const proxified = Symbol("proxified");
exports.serviceId = Symbol("serviceId");
function findId(target) {
    let str = target.toString(), re = /this(\.id|\['id'\]|\["id"\])\s*=\s*["'`](.*)["'`]\s*[;\r\n]/, matches = str.match(re);
    if (matches) {
        return matches[2];
    }
    else {
        throw new SyntaxError("no 'id' detected in the given service class");
    }
}
exports.findId = findId;
function send(event, uuid, ...data) {
    return Buffer.from(JSON.stringify([event, uuid, ...data]) + "\r\n\r\n");
}
exports.send = send;
function receive(buf) {
    let pack = buf.toString().split("\r\n\r\n"), parts = [];
    for (let part of pack) {
        if (part)
            parts.push(JSON.parse(part));
    }
    return parts;
}
exports.receive = receive;
function sendError(err) {
    let isError = err instanceof Error, res = !isError ? null : {
        name: err.name,
        message: err.message,
        stack: err.stack
    };
    if (isError) {
        for (let x in err) {
            res[x] = err[x];
        }
    }
    return res || err;
}
exports.sendError = sendError;
function receiveError(err) {
    if (err.name && "message" in err && "stack" in err) {
        let _err = Object.create(Error.prototype, {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        for (let x in err) {
            if (x != "name" && x != "message" && x != "stack") {
                _err[x] = err[x];
            }
        }
        err = _err;
    }
    return err;
}
exports.receiveError = receiveError;
exports.tasks = {};
function proxify(srv, srvId, ins) {
    return new Proxy(srv, {
        get: (srv, prop) => {
            if (!(prop in srv.constructor.prototype) || typeof srv[prop] != "function") {
                return srv[prop];
            }
            else if (!srv[prop][proxified]) {
                let fn = function (...data) {
                    return new Promise((resolve, reject) => {
                        let taskId = uuid();
                        let timer = setTimeout(() => {
                            reject(new Error("rpc request timeout after 5 seconds"));
                        }, ins.timeout);
                        ins["client"].write(send("rpc-request", srvId, taskId, prop, ...data));
                        exports.tasks[taskId] = {
                            success: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            },
                            error: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            }
                        };
                    });
                };
                set(fn, "name", srv[prop].name);
                set(fn, "length", srv[prop].length);
                set(fn, proxified, true);
                set(fn, "toString", function toString() {
                    return Function.prototype.toString.call(srv[prop]);
                }, true);
                return srv.constructor.prototype[prop] = fn;
            }
            else {
                return srv[prop];
            }
        }
    });
}
exports.proxify = proxify;
function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}
//# sourceMappingURL=util.js.map