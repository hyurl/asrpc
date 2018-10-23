import * as net from "net";
import * as path from "path";
import * as fs from "fs-extra";
import { EventEmitter } from "events";
import { generate as uniqid } from "shortid";
import {
    getClassId,
    send,
    receive,
    tasks,
    proxify,
    objectId,
    eventEmitter,
    isSocketResetError,
    absPath,
    classId
} from './util';

export type ServiceClass<T> = new (...args) => T;

export interface ServiceOptions {
    host?: string;
    port?: number;
    path?: string;
    timeout?: number;
}

/** A type that represents a service instance shipped on the server. */
export class ServiceInstance implements ServiceOptions {
    host?: string;
    port?: number;
    path?: string;
    timeout: number = 5000;
    private server: net.Server;
    private client: net.Socket;
    private errorHandler: (err: Error) => void;
    private services: {
        [id: string]: ServiceClass<any>
    } = {};
    private instances: {
        [oid: string]: any
    } = {};

    /**
     * Registers an ordinary JavaScript class (either in ES6 and ES5) as an RPC 
     * service.
     */
    register<T>(target: ServiceClass<T>): void {
        target[classId] = getClassId(target);
        this.services[target[classId]] = target;
    }

    /**
     * De-registers the target class bound by `register()`. Once a class is 
     * de-registered, it can no longer be connected on the client.
     */
    deregister<T>(target: ServiceClass<T>): void {
        if (target[classId])
            delete this.services[target[classId]];
    }

    /** 
     * Starts the service server, listening for connections and requests from a 
     * client.
     */
    start(): Promise<void> {
        return new Promise(async (resolve: (value?: any) => void, reject) => {
            let server: net.Server = net.createServer(),
                resolved = false;

            if (this.path) {
                await fs.ensureDir(path.dirname(this.path));

                if (await fs.pathExists(this.path)) {
                    await fs.unlink(this.path);
                }

                server.listen(this.path, () => {
                    (resolved = true) && resolve();
                });
            } else {
                server.listen(this.port, this.host, () => {
                    (resolved = true) && resolve();
                });
            }

            this.server = server;
            this.server.once("error", err => {
                !resolved && (resolved = true) && reject(err);
            }).on("error", err => {
                if (this.errorHandler && resolved) {
                    this.errorHandler.call(this, err);
                }
            }).on("connection", socket => {
                socket.on("data", buf => {
                    for (let [event, ...data] of receive(buf)) {
                        socket.emit(event, ...data);
                    }
                }).on("error", err => {
                    if (!isSocketResetError(err) && this.errorHandler) {
                        this.errorHandler.call(this, err);
                    }
                }).on("rpc-connect", (
                    oid: string,
                    name: string,
                    id: string,
                    ...args
                ) => {
                    if (this.services[id]) {
                        this.instances[oid] = new this.services[id](...args);
                        socket.write(send("rpc-connected", oid, id));
                    } else {
                        let err = new Error(`service '${name}' not registered`);
                        socket.write(send("rpc-connect-error", oid, err));
                    }
                }).on("rpc-disconnect", (oid: string) => {
                    delete this.instances[oid];
                }).on("rpc-request", async (
                    oid: string,
                    taskId: string,
                    method: string,
                    ...args
                ) => {
                    try {
                        let service = this.instances[oid],
                            res = await service[method](...args);

                        await new Promise(resolve => socket.write(
                            send("rpc-response", oid, taskId, res),
                            () => resolve()
                        ));
                    } catch (err) {
                        socket.write(send("rpc-error", oid, taskId, err));
                    }
                });
            });
        });
    }

    /**
     * Closes the service server shipped by the current instance. Once the 
     * server is closed, no more connections and requests should be delivered.
     */
    close(): Promise<void> {
        return new Promise(resolve => this.server.close(() => {
            this.server.unref();
            resolve();
        }));
    }

    /**
     * Connects to the service server and returns a new instance of `target`. 
     * @param args If provided, is any number of arguments passed to the class 
     * constructor. When the service is connected, they will be assigned to the 
     * instance on the server as well.
     */
    connect<T>(target: ServiceClass<T>, ...args: any[]): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                let resolved = false;
                let connect = () => {
                    if (this.path) {
                        this.client = net.createConnection(this.path);
                    } else {
                        this.client = net.createConnection(this.port, this.host);
                    }
                };

                connect();

                this.client.once("connect", () => {
                    (resolved = true) && resolve();
                }).once("error", err => {
                    !resolved && (resolved = true) && reject(err);
                }).on("error", err => {
                    if (isSocketResetError(err)) {
                        this.client.unref();

                        let times = 0;
                        let reconnect = () => {
                            let timer = setTimeout(() => {
                                connect();
                                times++;

                                if (times === 5) {
                                    clearTimeout(timer);
                                } else if (!this.client.destroyed
                                    || this.client.connecting) {
                                    clearTimeout(timer);
                                } else {
                                    reconnect();
                                }
                            }, 50);
                        };
                    } else if (this.errorHandler && resolved) {
                        this.errorHandler.call(this, err);
                    }
                }).on("data", buf => {
                    for (let [event, oid, ...data] of receive(buf)) {
                        this.instances[oid][eventEmitter].emit(event, ...data);
                    }
                });
            } else {
                resolve();
            }
        }).then(() => {
            return new Promise((resolve: (value: T) => void, reject) => {
                let srv = new target(...args);
                let oid = srv[objectId] = uniqid();
                let clsId = srv[classId] = target[classId]
                    || (target[classId] = getClassId(target));

                srv[eventEmitter] = new EventEmitter;
                this.instances[oid] = srv;
                this.client.write(
                    send("rpc-connect", oid, target.name, clsId, ...args)
                );

                srv[eventEmitter].once("rpc-connected", () => {
                    resolve(proxify(srv, oid, this));
                }).once("rpc-connect-error", (err: any) => {
                    reject(err);
                }).on("rpc-response", (taskId: string, res: any) => {
                    tasks[taskId].resolve(res);
                }).on("rpc-error", (taskId: string, err: any) => {
                    tasks[taskId].reject(err);
                });
            });
        });
    }

    /**
     * Disconnects the given service returned by `connect()`. Once a service is 
     * disconnected, no more operations should be called on it.
     */
    disconnect(service: any): Promise<void> {
        return new Promise(resolve => {
            let oid: string = service[objectId];

            if (!oid) return resolve();

            delete this.instances[oid];
            this.client.write(send("rpc-disconnect", oid), () => {
                resolve();
            });
        });
    }

    /**
     * Binds an error handler to be invoked whenever an error occurred in 
     * asynchronous operations which can't be caught during run-time.
     */
    onError(handler: (err: Error) => void) {
        this.errorHandler = handler;
    }
}

/**
 * Creates a `ServiceInstance` according to the given arguments.
 * @param path If provided, the instance binds to a UNIX domain socket or 
 *  **named pipe** on Windows, and communicate via IPC channels. This is very 
 *  useful and efficient when the client and server are both run in the same 
 *  machine. BUT must be aware that Windows named pipe has no support in cluster 
 *  mode.
 */
export function createInstance(path: string): ServiceInstance;
/**
 * @param port If provided, the instance binds to an network port, and 
 *  communicate through network card. This is mainly used when the server and 
 *  client are run in different machines, or in cluster on Windows.
 * @param host If the server and client are in different machine (even under 
 *  different domain), this option must be provided (on the client side, 
 *  optional on the server side).
 */
export function createInstance(port: number, host?: string): ServiceInstance;
/**
 * @param options If provided, it is an object that contains `path`, `port`, 
 *  `host` and `timeout` (all optional), the first three are corresponding to 
 *  the individual options talked above, while `timeout` is a number in 
 *  milliseconds and the default value is `5000`.
 */
export function createInstance(options: ServiceOptions): ServiceInstance;
export function createInstance(): ServiceInstance {
    let ins = new ServiceInstance;

    if (typeof arguments[0] == "object") {
        Object.assign(ins, arguments[0]);
    } else if (typeof arguments[0] == "string") {
        ins.path = absPath(arguments[0]);
    } else {
        ins.port = arguments[0];
        ins.host = arguments[1];
    }

    return ins;
}

export default createInstance;