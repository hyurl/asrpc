import hash = require("object-hash");
import * as path from "path";
import * as os from "os";
import { encode, decode } from "encoded-buffer";
import { ServiceClass, ServiceInstance } from "./index";

export const classId = Symbol("classId");
export const objectId = Symbol("objectId");
export const eventEmitter = Symbol("eventEmitter");
export const tasks: {
    [id: number]: {
        resolve: (res) => void,
        reject: (err) => void
    };
} = {};

export enum RPCEvents {
    CONNECT,
    CONNECTED,
    CONNECT_ERROR,
    DISCONNECT,
    REQUEST,
    RESPONSE,
    ERROR,
}

const proxified = Symbol("proxified");
var taskId = 0;

export function getClassId<T>(target: ServiceClass<T>): string {
    return hash(target).slice(0, 8);
}

export function send(event: string | number, id: string | number, ...data: any[]) {
    return Buffer.concat([
        encode([event, id, ...data]),
        Buffer.from("\r\n\r\n")
    ]);
}

export function receive(buf: Buffer): Array<[string | number, string | number, any]> {
    let pack = splitBuffer(buf, "\r\n\r\n"),
        parts = [];

    for (let part of pack) {
        if (part) parts.push(decode(part)[0]);
    }

    return parts;
}

export function proxify(srv: any, oid: number, ins: ServiceInstance): any {
    return new Proxy(srv, {
        get: (srv, prop: string) => {
            if (!(prop in srv.constructor.prototype)
                || typeof srv[prop] != "function") {
                return srv[prop];
            } else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000),
                                unit = num === 1 ? "second" : "seconds";

                            reject(new Error(
                                `RPC request timeout after ${num} ${unit}`
                            ));
                        }, ins.timeout);

                        ins["client"].write(
                            send(RPCEvents.REQUEST, oid, taskId, prop, ...args)
                        );
                        tasks[taskId] = {
                            resolve: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete tasks[taskId];
                            },
                            reject: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete tasks[taskId];
                            }
                        };

                        taskId++;
                        if (taskId === Number.MAX_SAFE_INTEGER)
                            taskId = 0;
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
            } else {
                return srv[prop];
            }
        }
    });
}

export function absPath(filename: string): string {
    // resolve path to be absolute
    if (!path.isAbsolute(filename)) {
        filename = path.resolve(os.tmpdir(), ".asrpc", filename);
    }

    if (os.platform() == "win32" && !(/\\\\[\?\.]\\pipe\\/.test(filename))) {
        filename = "\\\\?\\pipe\\" + filename;
    }

    return filename;
}

function splitBuffer(buf: Buffer, sep: string) {
    let parts: Buffer[] = [],
        offset = 0,
        index = -1;

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