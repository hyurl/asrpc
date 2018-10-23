import { generate as uniqid } from "shortid";
import hash = require("object-hash");
import { AssertionError } from 'assert';
import * as path from "path";
import * as os from "os";
import { ServiceClass, ServiceInstance } from "./index";

const proxified = Symbol("proxified");
export const classId = Symbol("classId");
export const objectId = Symbol("objectId");
export const eventEmitter = Symbol("eventEmitter");

export function getClassId<T>(target: ServiceClass<T>): string {
    return hash(target).slice(0, 8);
}

export function send(event: string, uniqid: string, ...data: any[]) {
    return Buffer.from(JSON.stringify([event, uniqid, ...data]) + "\r\n\r\n");
}

export function receive(buf: Buffer): Array<[string, string, any]> {
    let pack = buf.toString().split("\r\n\r\n"),
        parts = [];

    for (let part of pack) {
        if (part) parts.push(JSON.parse(part));
    }

    return parts;
}

export function sendError(err: any) {
    let isError = err instanceof Error,
        res = !isError ? null : {
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

export function receiveError(err: any) {
    if (err.name && "message" in err && "stack" in err) {
        let constructor: Function;

        switch (err.name) {
            case EvalError.name:
                constructor = EvalError;
                break;
            case RangeError.name:
                constructor = RangeError;
                break;
            case ReferenceError.name:
                constructor = ReferenceError;
                break;
            case SyntaxError.name:
                constructor = SyntaxError;
                break;
            case TypeError.name:
                constructor = TypeError;
                break;
            default:
                constructor = err.name.includes("AssertionError")
                    ? AssertionError
                    : Error;
                break;
        }

        let _err = Object.create(constructor.prototype, {
            name: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.name
            },
            message: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.message
            },
            stack: {
                configurable: true,
                writable: true,
                enumerable: false,
                value: err.stack
            }
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

export const tasks: {
    [uniqid: string]: {
        success: (res) => void,
        error: (err) => void
    };
} = {};

export function proxify(srv: any, srvId: string, ins: ServiceInstance): any {
    return new Proxy(srv, {
        get: (srv, prop: string) => {
            if (!(prop in srv.constructor.prototype) || typeof srv[prop] != "function") {
                return srv[prop];
            } else if (!srv[prop][proxified]) {
                let fn = function (...args) {
                    return new Promise((resolve, reject) => {
                        let taskId = uniqid();
                        let timer = setTimeout(() => {
                            let num = Math.round(ins.timeout / 1000),
                                unit = num === 1 ? "second" : "seconds";

                            reject(new Error(`rpc request timeout after ${num} ${unit}`));
                        }, ins.timeout);

                        ins["client"].write(send("rpc-request", srvId, taskId, prop, ...args));
                        tasks[taskId] = {
                            success: (res) => {
                                resolve(res);
                                clearTimeout(timer);
                                delete tasks[taskId];
                            },
                            error: (err) => {
                                reject(err);
                                clearTimeout(timer);
                                delete tasks[taskId];
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
            } else {
                return srv[prop];
            }
        }
    });
}

function set(target, prop, value, writable = false) {
    Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable,
        value
    });
}

export function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
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