# AS-RPC

**A tool to make your class as an RPC service.**

## Idea

*AS* first means English word *as*, that this package will make your class as an
RPC service, And secondly, it also means *as-is*, that no matter how you use the
instance of the class, the usage (syntax) is the same on the server and the 
client. You don't have to change any API of the class, this package is meant to 
wrap your ordinary classes RPC-like.

## Example

```javascript
// SimpleCalculator.js
// for convenience, all remote methods should be async
class SimpleCalculator {
    async sum(...args) {
        console.log(args.join(" + "));
        return args.reduce((a, b) => a + b);
    }

    async sub(...args) {
        console.log(args.join(" - "));
        return args.reduce((a, b) => a - b);
    }

    async multiply(...args) {
        console.log(args.join(" * "));
        return args.reduce((a, b) => a * b);
    }

    async div(...args) {
        console.log(args.join(" / "));
        return args.reduce((a, b) => a / b);
    }
}

exports.SimpleCalculator = SimpleCalculator;
```

```javascript
// server.js
const { createInstance } = require("asrpc");
const { SimpleCalculator } = require("./SimpleCalculator");

var ins = createInstance(2018); // bind port 2018

ins.register(SimpleCalculator); // register service

(async () => {
    await ins.start(); // start service instance
});
```

```javascript
// client.js
const { createInstance } = require("asrpc");
const { SimpleCalculator } = require("./SimpleCalculator");

var ins = createInstance(2018); // also bind port 2018

(async () => {
    var calc = await ins.connect(SimpleCalculator); // connect service
    console.log(await calc.sum(1, 2, 3, 4, 5)); // => 15
    console.log(await calc.sub(15, 5, 4, 3, 2)); // => 1
    console.log(await calc.multiply(1, 2, 3, 4, 5)); // => 120
    console.log(await calc.div(120, 5, 4, 3, 2)); // => 1
});
```

First run `server.js` then run `client.js`.

`server.js` will output:

```
1 + 2 + 3 + 4 + 5
15 - 5 - 4 - 3 - 2
1 * 2 * 3 * 4 * 5
120 / 5 / 4 / 3 / 2
```

and `client.js` will output:

```
15
1
120
1
```

## API

### `createInstance`

This is the only useful function in JavaScript that exposed by this package, 
other objects and interfaces are for TypeScript programming.

**signatures:**

- `createInstance(path: string): ServiceInstance`
- `createInstance(port: number, host?: string): ServiceInstance`
- `createInstance(options: ServiceOptions): ServiceInstance`

Creates a `ServiceInstance` according to the given arguments.

If `path` is provided, the instance binds to a UNIX domain socket or 
**named pipe** on Windows, and communicate via IPC channels. This is very useful
and efficient when the client and server are both run in the same machine. BUT 
must be aware that Windows named pipe has no support in cluster mode.

If `port` is provided, the instance binds to an network port, and communicate 
through network card. This is mainly used when the server and client are run in 
different machine, or in cluster on Windows. If the server and client are in 
different machine (even under different domain), the `host` option must be 
provided (on the client side, optional on the server side).

If `options` is provided, it is an object that contains (all optional) `path`, 
`port`, `host` and `timeout`, the first three are corresponding to the 
individual options talked above, while `timeout` is a number in milliseconds and
the default value is `5000`.

### `ServiceInstance`

A type that represents a service instance shipped on the server. This is class 
exposed in JavaScript as well, but not recommended in use, it should only for 
typing usage, because function `createInstance` provides a more suitable 
interface.

#### `ServiceInstance.prototype.register(target: Function): void`

This method registers a class, any ordinary JavaScript class (both in ES6 and 
ES5), as an RPC service. It doesn't do any other job, just make a reference in 
the internal map with to a unique-supposed string id generated according to the
class definition itself.

**This method should only be called on the server side.**

#### `ServiceInstance.prototype.deregister(target: Function): void`

This method de-registers the class bound by `register`, once a class is 
de-registered, it can no longer be connected on the client.

**This method should only be called on the server side.**

#### `ServiceInstance.prototype.start(): Promise<void>`

This method starts the RPC server, listening for connection and requests from 
a client.

**This method can only be called on the server side.**

#### `ServiceInstance.prototype.connect<T>(target: new (...args) => T): Promise<T>`

This method connects to the RPC server and returns a new instance of target.

**This method can only be called on the client side.**