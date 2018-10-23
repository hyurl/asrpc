"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shortid_1 = require("shortid");
const hash = require("object-hash");
const path = require("path");
const os = require("os");
const encoded_buffer_1 = require("encoded-buffer");
exports.classId = Symbol("classId");
exports.objectId = Symbol("objectId");
exports.eventEmitter = Symbol("eventEmitter");
exports.tasks = {};
const proxified = Symbol("proxified");
function getClassId(target) {
    return hash(target).slice(0, 8);
}
exports.getClassId = getClassId;
function send(event, uniqid, ...data) {
    return Buffer.concat([
        encoded_buffer_1.encode([event, uniqid, ...data]),
        Buffer.from("\r\n\r\n")
    ]);
}
exports.send = send;
function receive(buf) {
    let pack = splitBuffer(buf, "\r\n\r\n"), parts = [];
    for (let part of pack) {
        if (part)
            parts.push(encoded_buffer_1.decode(part)[0]);
    }
    return parts;
}
exports.receive = receive;
function proxify(srv, srvId, ins) {
    return new Proxy(srv, {
        get: (srv, prop) => {
            if (!(prop in srv.constructor.prototype)
                || typeof srv[prop] != "function") {
                return srv[prop];
            }
            else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let taskId = shortid_1.generate();
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000), unit = num === 1 ? "second" : "seconds";
                            reject(new Error(`RPC request timeout after ${num} ${unit}`));
                        }, ins.timeout);
                        ins["client"].write(send("rpc-request", srvId, taskId, prop, ...args));
                        exports.tasks[taskId] = {
                            resolve: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            },
                            reject: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete exports.tasks[taskId];
                            }
                        };
                    });
                };
                set(fn, prop, fn);
                set(fn, "name", srv[prop].name);
                set(fn, "length", srv[prop].length);
                set(fn, proxified, true);
                set(fn, "toString", function toString() {
                    return Function.prototype.toString.call(srv[prop]);
                }, true);
                return fn;
            }
            else {
                return srv[prop];
            }
        }
    });
}
exports.proxify = proxify;
function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
}
exports.isSocketResetError = isSocketResetError;
function absPath(filename) {
    if (!path.isAbsolute(filename)) {
        filename = path.resolve(os.tmpdir(), ".asrpc", filename);
    }
    if (os.platform() == "win32" && !(/\\\\[\?\.]\\pipe\\/.test(filename))) {
        filename = "\\\\?\\pipe\\" + filename;
    }
    return filename;
}
exports.absPath = absPath;
function splitBuffer(buf, sep) {
    let parts = [], offset = 0, index = -1;
    while (0 <= (index = buf.indexOf(sep, offset))) {
        parts.push(buf.slice(offset, index));
        offset = index + sep.length;
    }
    return parts;
}
function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}
//# sourceMappingURL=util.js.map